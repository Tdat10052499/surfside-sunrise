import { randomInt } from "node:crypto";

// No 0/O, 1/I/L or U, so guests can read a code out over the phone.
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";

/** Booking reference shown to guests, e.g. "SSR-7K4Q2M". */
export function newBookingCode(): string {
  let code = "";
  for (let i = 0; i < 6; i++) code += ALPHABET[randomInt(ALPHABET.length)];
  return `SSR-${code}`;
}
