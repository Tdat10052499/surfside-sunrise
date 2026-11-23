// Password rules, shared by the change-password form (browser) and the server.
// No Node imports here: this file is bundled into the client.

export const PASSWORD_MIN_LENGTH = 12;
export const PASSWORD_MAX_LENGTH = 128;

export type PasswordRule = { id: "length" | "mix"; text: string; ok: boolean };

/** The rules the form shows as a checklist. The server checks the same ones. */
export function passwordRules(password: string): PasswordRule[] {
  return [
    { id: "length", text: `At least ${PASSWORD_MIN_LENGTH} characters`, ok: password.length >= PASSWORD_MIN_LENGTH },
    { id: "mix", text: "Letters and numbers", ok: /\p{L}/u.test(password) && /\p{N}/u.test(password) },
  ];
}

export type NewPasswordProblem = "rules" | "too_long" | "mismatch" | "same_as_current" | "contains_email";

export function checkNewPassword(input: {
  password: string;
  repeat: string;
  current: string;
  email: string;
}): NewPasswordProblem | null {
  const { password, repeat, current, email } = input;
  if (password.length > PASSWORD_MAX_LENGTH) return "too_long";
  if (!passwordRules(password).every((r) => r.ok)) return "rules";
  if (password !== repeat) return "mismatch";
  if (password === current) return "same_as_current";
  const local = email.split("@")[0]?.toLowerCase() ?? "";
  if (local.length >= 4 && password.toLowerCase().includes(local)) return "contains_email";
  return null;
}
