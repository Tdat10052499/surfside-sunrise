// Encryption for keys stored in the database (service_credentials). AES-256-GCM:
// a stolen database dump is useless without SECRETS_KEY, and a tampered value fails
// to decrypt instead of decrypting to garbage.
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";

const VERSION = "v1";

export class SecretsKeyMissing extends Error {
  constructor() {
    super("SECRETS_KEY is not set, so keys can't be stored. The site team sets it once in Vercel.");
    this.name = "SecretsKeyMissing";
  }
}

function keyBytes(key: string | undefined): Buffer {
  if (!key) throw new SecretsKeyMissing();
  const bytes = Buffer.from(key, "base64");
  if (bytes.length !== 32) throw new Error("SECRETS_KEY must be 32 bytes, base64-encoded.");
  return bytes;
}

export function encryptSecret(plain: string, key: string | undefined): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", keyBytes(key), iv);
  const body = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  return [VERSION, iv.toString("base64"), cipher.getAuthTag().toString("base64"), body.toString("base64")].join(":");
}

export function decryptSecret(stored: string, key: string | undefined): string {
  const [version, iv, tag, body] = stored.split(":");
  if (version !== VERSION || !iv || !tag || body === undefined) throw new Error("Unreadable stored secret.");
  const decipher = createDecipheriv("aes-256-gcm", keyBytes(key), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}

/** "sk_live_…abcd": enough to recognise a key, never enough to use it. */
export function maskKey(key: string): string {
  const prefix = /^[a-z]+_(test|live)_/.exec(key)?.[0] ?? "";
  return `${prefix}…${key.slice(-4)}`;
}
