// Server-side price calculation (§3). Pure: no I/O, so it can be unit tested
// and is the only place a price is ever computed. The browser may show an
// estimate, but bookings and Stripe sessions always use a fresh server quote.

import { dayOfWeek, inRange, isIsoDate, nightCount, stayNights, type IsoDate } from "@/lib/dates";
import { assertCents, percentOf, type Cents } from "@/lib/money";

export type RateRule =
  | { kind: "BASE"; nightlyCents: Cents }
  | { kind: "WEEKEND"; nightlyCents: Cents }
  /** Covers nights in [start, end). */
  | { kind: "SEASON"; nightlyCents: Cents; start: IsoDate; end: IsoDate; label?: string }
  | { kind: "DATE"; nightlyCents: Cents; date: IsoDate };

export type TaxRate = {
  name: string;
  basisPoints: number;
  appliesToNightly: boolean;
  appliesToCleaning: boolean;
  appliesToPet: boolean;
};

export type PricingProperty = {
  maxGuests: number;
  /** null while the owner has not set a limit. */
  maxPets: number | null;
  minNights: number;
  cleaningFeeCents: Cents;
  petFeeCents: Cents;
  /** Nights (0 = Sunday) priced with the WEEKEND rate. */
  weekendNights: readonly number[];
};

/** ASSUMPTION: Friday and Saturday nights are weekend nights until the owner says otherwise. */
export const DEFAULT_WEEKEND_NIGHTS: readonly number[] = [5, 6];

export type QuoteRequest = {
  checkIn: IsoDate;
  checkOut: IsoDate;
  guests: number;
  pets: number;
};

export type NightPrice = { date: IsoDate; kind: RateRule["kind"]; cents: Cents };

export type QuoteLine = {
  code: "NIGHTS" | "CLEANING" | "PET" | "TAX";
  label: string;
  quantity: number;
  unitCents: Cents | null;
  amountCents: Cents;
};

export type Quote = {
  nights: NightPrice[];
  lines: QuoteLine[];
  subtotalCents: Cents;
  taxCents: Cents;
  totalCents: Cents;
};

export type QuoteError =
  | { code: "INVALID_DATES" }
  | { code: "MIN_NIGHTS"; minNights: number }
  | { code: "TOO_MANY_GUESTS"; maxGuests: number }
  | { code: "INVALID_GUESTS" }
  | { code: "TOO_MANY_PETS"; maxPets: number }
  | { code: "RATE_MISSING"; date: IsoDate }
  | { code: "RATE_CONFLICT"; date: IsoDate; kind: RateRule["kind"] };

export type QuoteResult = { ok: true; quote: Quote } | { ok: false; error: QuoteError };

const PRIORITY: RateRule["kind"][] = ["DATE", "SEASON", "WEEKEND", "BASE"];

function rateApplies(rule: RateRule, night: IsoDate, weekendNights: readonly number[]): boolean {
  switch (rule.kind) {
    case "BASE":
      return true;
    case "WEEKEND":
      return weekendNights.includes(dayOfWeek(night));
    case "SEASON":
      return inRange(night, rule.start, rule.end);
    case "DATE":
      return rule.date === night;
  }
}

function priceNight(
  night: IsoDate,
  rules: readonly RateRule[],
  weekendNights: readonly number[],
): NightPrice | QuoteError {
  for (const kind of PRIORITY) {
    const matches = rules.filter((r) => r.kind === kind && rateApplies(r, night, weekendNights));
    if (matches.length > 1) return { code: "RATE_CONFLICT", date: night, kind };
    if (matches.length === 1) {
      return { date: night, kind, cents: assertCents(matches[0].nightlyCents, "nightlyCents") };
    }
  }
  return { code: "RATE_MISSING", date: night };
}

export function quoteStay(
  request: QuoteRequest,
  property: PricingProperty,
  rules: readonly RateRule[],
  taxes: readonly TaxRate[] = [],
): QuoteResult {
  const { checkIn, checkOut, guests, pets } = request;

  if (!isIsoDate(checkIn) || !isIsoDate(checkOut) || checkOut <= checkIn) {
    return { ok: false, error: { code: "INVALID_DATES" } };
  }
  const count = nightCount(checkIn, checkOut);
  if (count < property.minNights) {
    return { ok: false, error: { code: "MIN_NIGHTS", minNights: property.minNights } };
  }
  if (!Number.isInteger(guests) || guests < 1 || !Number.isInteger(pets) || pets < 0) {
    return { ok: false, error: { code: "INVALID_GUESTS" } };
  }
  if (guests > property.maxGuests) {
    return { ok: false, error: { code: "TOO_MANY_GUESTS", maxGuests: property.maxGuests } };
  }
  if (property.maxPets !== null && pets > property.maxPets) {
    return { ok: false, error: { code: "TOO_MANY_PETS", maxPets: property.maxPets } };
  }

  const nights: NightPrice[] = [];
  for (const night of stayNights(checkIn, checkOut)) {
    const priced = priceNight(night, rules, property.weekendNights);
    if ("code" in priced) return { ok: false, error: priced };
    nights.push(priced);
  }

  const nightlyCents = nights.reduce((sum, n) => sum + n.cents, 0);
  const cleaningCents = assertCents(property.cleaningFeeCents, "cleaningFeeCents");
  const petCents = assertCents(property.petFeeCents, "petFeeCents") * pets;

  const lines: QuoteLine[] = [
    {
      code: "NIGHTS",
      label: `${count} night${count === 1 ? "" : "s"}`,
      quantity: count,
      unitCents: null,
      amountCents: nightlyCents,
    },
  ];
  if (cleaningCents > 0) {
    lines.push({
      code: "CLEANING",
      label: "Cleaning fee",
      quantity: 1,
      unitCents: cleaningCents,
      amountCents: cleaningCents,
    });
  }
  if (pets > 0 && petCents > 0) {
    lines.push({
      code: "PET",
      label: `Pet fee (${pets})`,
      quantity: pets,
      unitCents: property.petFeeCents,
      amountCents: petCents,
    });
  }
  const subtotalCents = nightlyCents + cleaningCents + petCents;

  // Each tax is rounded once, on its own taxable base.
  let taxCents = 0;
  for (const tax of taxes) {
    const base =
      (tax.appliesToNightly ? nightlyCents : 0) +
      (tax.appliesToCleaning ? cleaningCents : 0) +
      (tax.appliesToPet ? petCents : 0);
    const amount = percentOf(base, tax.basisPoints);
    if (amount === 0) continue;
    taxCents += amount;
    lines.push({ code: "TAX", label: tax.name, quantity: 1, unitCents: null, amountCents: amount });
  }

  return {
    ok: true,
    quote: { nights, lines, subtotalCents, taxCents, totalCents: subtotalCents + taxCents },
  };
}
