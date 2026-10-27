// Calendar dates for stays. A stay is the half-open range [checkIn, checkOut):
// the guest sleeps every night from checkIn up to, not including, checkOut.
// Dates are plain "YYYY-MM-DD" strings in the home's local calendar, so no
// time zone conversion ever applies to them.

export type IsoDate = string;

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
const DAY_MS = 86_400_000;

function toUtcMs(date: IsoDate): number {
  const m = ISO_DATE.exec(date);
  if (!m) throw new RangeError(`Invalid date: ${date}`);
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const ms = Date.UTC(y, mo - 1, d);
  // Reject dates such as 2026-02-30 that Date.UTC silently rolls over.
  if (new Date(ms).getUTCDate() !== d) throw new RangeError(`Invalid date: ${date}`);
  return ms;
}

function fromUtcMs(ms: number): IsoDate {
  return new Date(ms).toISOString().slice(0, 10);
}

export function isIsoDate(value: string): boolean {
  try {
    toUtcMs(value);
    return true;
  } catch {
    return false;
  }
}

export function addDays(date: IsoDate, days: number): IsoDate {
  return fromUtcMs(toUtcMs(date) + days * DAY_MS);
}

export function nightCount(checkIn: IsoDate, checkOut: IsoDate): number {
  return Math.round((toUtcMs(checkOut) - toUtcMs(checkIn)) / DAY_MS);
}

/** Every night of the stay, as the date the night starts on. */
export function stayNights(checkIn: IsoDate, checkOut: IsoDate): IsoDate[] {
  const n = nightCount(checkIn, checkOut);
  return Array.from({ length: Math.max(n, 0) }, (_, i) => addDays(checkIn, i));
}

/** 0 = Sunday … 6 = Saturday. */
export function dayOfWeek(date: IsoDate): number {
  return new Date(toUtcMs(date)).getUTCDay();
}

/** True when `date` lies in [start, end). */
export function inRange(date: IsoDate, start: IsoDate, end: IsoDate): boolean {
  return date >= start && date < end;
}
