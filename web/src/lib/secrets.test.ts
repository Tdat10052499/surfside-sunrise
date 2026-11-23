import { randomBytes } from "node:crypto";
import { describe, expect, it } from "vitest";
import { decryptSecret, encryptSecret, maskKey, SecretsKeyMissing } from "./secrets";

const key = randomBytes(32).toString("base64");

describe("stored secrets", () => {
  it("round-trips and never stores the plain value", () => {
    const stored = encryptSecret("rk_test_51Abc", key);
    expect(stored).not.toContain("rk_test_51Abc");
    expect(decryptSecret(stored, key)).toBe("rk_test_51Abc");
  });

  it("uses a fresh IV every time", () => {
    expect(encryptSecret("same", key)).not.toBe(encryptSecret("same", key));
  });

  it("refuses a wrong key or a tampered value", () => {
    const stored = encryptSecret("rk_test_51Abc", key);
    expect(() => decryptSecret(stored, randomBytes(32).toString("base64"))).toThrow();
    const parts = stored.split(":");
    parts[3] = Buffer.from("tampered").toString("base64");
    expect(() => decryptSecret(parts.join(":"), key)).toThrow();
  });

  it("explains a missing SECRETS_KEY", () => {
    expect(() => encryptSecret("x", undefined)).toThrow(SecretsKeyMissing);
  });

  it("masks keys", () => {
    expect(maskKey("rk_live_51AbcdefWXYZ")).toBe("rk_live_…WXYZ");
    expect(maskKey("whsec_123456789")).toBe("…6789");
  });
});
