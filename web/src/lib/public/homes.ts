// What the public site may read about homes: published homes, the nights that are
// taken, and server-side quotes. Nothing here returns guest data or says why a night
// is taken (booking, hold or owner block).
import { and, asc, eq, sql } from "drizzle-orm";
import type { Db } from "@/db/client";
import { properties, rateRules, taxRates } from "@/db/schema";
import { addDays, isIsoDate, nightCount, type IsoDate } from "@/lib/dates";
import { DEFAULT_WEEKEND_NIGHTS, quoteStay, type Quote, type QuoteError, type RateRule } from "@/lib/pricing/quote";

/** Longest window the calendar can ask for at once (about 18 months). */
export const MAX_CALENDAR_DAYS = 550;
/** Longest stay a quote accepts. ASSUMPTION until the owner sets a limit. */
export const MAX_STAY_NIGHTS = 60;
/** How far ahead a stay may start. ASSUMPTION until the owner sets a limit. */
export const MAX_DAYS_AHEAD = 548;

export type PublicHome = {
  slug: string;
  name: string;
  maxGuests: number;
  /** null: no limit set by the owner yet. */
  maxPets: number | null;
  minNights: number;
  currency: string;
  timezone: string;
  cleaningFeeCents: number;
  petFeeCents: number;
};

const publicColumns = {
  slug: properties.slug,
  name: properties.name,
  maxGuests: properties.maxGuests,
  maxPets: properties.maxPets,
  minNights: properties.minNights,
  currency: properties.currency,
  timezone: properties.timezone,
  cleaningFeeCents: properties.cleaningFeeCents,
  petFeeCents: properties.petFeeCents,
};

export async function listHomes(db: Db): Promise<PublicHome[]> {
  return db
    .select(publicColumns)
    .from(properties)
    .where(eq(properties.status, "PUBLISHED"))
    .orderBy(asc(properties.name));
}

export async function findHome(db: Db, slug: string) {
  const [row] = await db
    .select({ id: properties.id, ...publicColumns })
    .from(properties)
    .where(and(eq(properties.slug, slug), eq(properties.status, "PUBLISHED")));
  return row ?? null;
}

export async function getHome(db: Db, slug: string): Promise<PublicHome | null> {
  const [row] = await db
    .select(publicColumns)
    .from(properties)
    .where(and(eq(properties.slug, slug), eq(properties.status, "PUBLISHED")));
  return row ?? null;
}

/** Today's date in the home's own time zone. */
export function localToday(timezone: string, now: Date): IsoDate {
  // en-CA formats as YYYY-MM-DD.
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

/** A run of taken nights: every night from `start` up to, not including, `end`. */
export type TakenRange = { start: IsoDate; end: IsoDate };

/**
 * Taken nights between `from` and `to` (half-open), merged into ranges. A hold whose
 * time ran out no longer counts, even before the cleanup job marks it expired.
 */
async function takenRanges(db: Db, propertyId: string, from: IsoDate, to: IsoDate, now: Date): Promise<TakenRange[]> {
  const rows = await db.execute<{ start: string; end: string }>(sql`
    select lower(r)::text as start, upper(r)::text as "end"
      from unnest((
        select range_agg(o.during * daterange(${from}::date, ${to}::date))
          from occupancy o
          left join bookings b on b.id = o.booking_id
         where o.property_id = ${propertyId}::uuid
           and o.active
           and o.during && daterange(${from}::date, ${to}::date)
           and not coalesce(b.status = 'HOLD' and b.hold_expires_at <= ${now.toISOString()}::timestamptz, false)
      )) as r
     order by 1`);
  return rows.map((r) => ({ start: r.start, end: r.end }));
}

export type CalendarResult =
  { ok: true; from: IsoDate; to: IsoDate; taken: TakenRange[] } | { ok: false; error: "NOT_FOUND" | "INVALID_RANGE" };

/** Taken nights for the booking calendar. Defaults to the next 12 months. */
export async function homeCalendar(
  db: Db,
  slug: string,
  range: { from?: string; to?: string },
  now = new Date(),
): Promise<CalendarResult> {
  const home = await findHome(db, slug);
  if (!home) return { ok: false, error: "NOT_FOUND" };
  const from = range.from ?? localToday(home.timezone, now);
  const to = range.to ?? addDays(from, 365);
  if (!isIsoDate(from) || !isIsoDate(to) || to <= from || nightCount(from, to) > MAX_CALENDAR_DAYS) {
    return { ok: false, error: "INVALID_RANGE" };
  }
  return { ok: true, from, to, taken: await takenRanges(db, home.id, from, to, now) };
}

export type PublicQuoteError =
  | QuoteError
  | { code: "NOT_FOUND" }
  | { code: "PAST_DATES" }
  | { code: "TOO_FAR_AHEAD"; maxDaysAhead: number }
  | { code: "TOO_LONG"; maxNights: number }
  | { code: "DATES_TAKEN"; taken: TakenRange[] };

export type PublicQuoteResult = { ok: true; quote: Quote; currency: string } | { ok: false; error: PublicQuoteError };

/**
 * Prices a stay with the server's own rates and checks the nights are free. The
 * browser shows this; a booking always asks for a fresh quote when it is created.
 */
export async function quoteHome(
  db: Db,
  slug: string,
  request: { checkIn: string; checkOut: string; guests: number; pets: number },
  now = new Date(),
): Promise<PublicQuoteResult> {
  const home = await findHome(db, slug);
  if (!home) return { ok: false, error: { code: "NOT_FOUND" } };
  const { checkIn, checkOut } = request;
  if (!isIsoDate(checkIn) || !isIsoDate(checkOut) || checkOut <= checkIn) {
    return { ok: false, error: { code: "INVALID_DATES" } };
  }
  const today = localToday(home.timezone, now);
  if (checkIn < today) return { ok: false, error: { code: "PAST_DATES" } };
  if (nightCount(today, checkIn) > MAX_DAYS_AHEAD) {
    return { ok: false, error: { code: "TOO_FAR_AHEAD", maxDaysAhead: MAX_DAYS_AHEAD } };
  }
  if (nightCount(checkIn, checkOut) > MAX_STAY_NIGHTS) {
    return { ok: false, error: { code: "TOO_LONG", maxNights: MAX_STAY_NIGHTS } };
  }

  const [rules, taxes] = await Promise.all([
    db.select().from(rateRules).where(eq(rateRules.propertyId, home.id)),
    db
      .select()
      .from(taxRates)
      .where(and(eq(taxRates.propertyId, home.id), eq(taxRates.active, true))),
  ]);
  const result = quoteStay(
    request,
    { ...home, weekendNights: DEFAULT_WEEKEND_NIGHTS },
    rules.map(toRateRule),
    taxes.map((t) => ({
      name: t.name,
      basisPoints: t.rateBasisPoints,
      appliesToNightly: t.appliesToNightly,
      appliesToCleaning: t.appliesToCleaning,
      appliesToPet: t.appliesToPet,
    })),
  );
  if (!result.ok) return result;

  const taken = await takenRanges(db, home.id, checkIn, checkOut, now);
  if (taken.length > 0) return { ok: false, error: { code: "DATES_TAKEN", taken } };
  return { ok: true, quote: result.quote, currency: home.currency };
}

/** "[2026-12-01,2026-12-05)" → start and end dates. */
function parseDaterange(value: string | null): { start: IsoDate; end: IsoDate } {
  const m = value && /^\[(\d{4}-\d{2}-\d{2}),(\d{4}-\d{2}-\d{2})\)$/.exec(value);
  if (!m) throw new Error(`Unexpected daterange: ${value}`);
  return { start: m[1], end: m[2] };
}

function toRateRule(row: typeof rateRules.$inferSelect): RateRule {
  switch (row.kind) {
    case "BASE":
    case "WEEKEND":
      return { kind: row.kind, nightlyCents: row.nightlyCents };
    case "SEASON": {
      const { start, end } = parseDaterange(row.during);
      return { kind: "SEASON", nightlyCents: row.nightlyCents, start, end, label: row.label ?? undefined };
    }
    case "DATE":
      return { kind: "DATE", nightlyCents: row.nightlyCents, date: parseDaterange(row.during).start };
  }
}
