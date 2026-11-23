// Password hashing and the password rules shown on the change-password screen.
// scrypt from node:crypto: memory-hard, built in, no native dependency to install.
import { randomBytes, scrypt as scryptCb, timingSafeEqual, type ScryptOptions } from "node:crypto";

const scrypt = (password: string, salt: Buffer, keylen: number, opts: ScryptOptions) =>
  new Promise<Buffer>((resolve, reject) =>
    scryptCb(password, salt, keylen, opts, (err, key) => (err ? reject(err) : resolve(key))),
  );

// OWASP's scrypt baseline is N=2^17, r=8, p=1; 2^15 keeps a sign-in near 50 ms on a
// small serverless instance. Parameters are stored in each hash, so they can be raised later.
const PARAMS = { N: 2 ** 15, r: 8, p: 1 } as const;
const KEY_LENGTH = 32;
const maxmem = (N: number, r: number) => 128 * N * r * 2;

export { PASSWORD_MAX_LENGTH, PASSWORD_MIN_LENGTH, checkNewPassword, passwordRules } from "./password-rules.ts";
export type { NewPasswordProblem, PasswordRule } from "./password-rules.ts";

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const { N, r, p } = PARAMS;
  const key = await scrypt(password.normalize("NFKC"), salt, KEY_LENGTH, { N, r, p, maxmem: maxmem(N, r) });
  return ["scrypt", N, r, p, salt.toString("base64"), key.toString("base64")].join("$");
}

/** False for a wrong password or a hash it cannot read; never throws on bad input. */
export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;
  const [N, r, p] = parts.slice(1, 4).map(Number);
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (![N, r, p].every(Number.isSafeInteger) || expected.length === 0) return false;
  try {
    const key = await scrypt(password.normalize("NFKC"), salt, expected.length, { N, r, p, maxmem: maxmem(N, r) });
    return timingSafeEqual(key, expected);
  } catch {
    return false;
  }
}

/** A hash of a random password, verified against when the email is unknown so timing doesn't reveal it. */
let decoy: Promise<string> | undefined;
export const decoyHash = () => (decoy ??= hashPassword(randomBytes(16).toString("hex")));
