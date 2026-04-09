// Shared helpers for PayPal data integrity checks.
// Used by both backend routers and frontend components.

export const EMAIL_REGEX = /[\w.+-]+@[\w-]+\.[\w.-]+/g;

/**
 * Extract all emails from a string. Handles multi-email cells like
 * "oanh@gmail.com  max@hotmail.com" or "a@x.com,b@y.com".
 * Returns a deduped, lowercased list. Safe for null/undefined input.
 */
export function extractEmails(text: string | null | undefined): string[] {
  if (!text) return [];
  const matches = text.match(EMAIL_REGEX) ?? [];
  const cleaned = matches.map((e) => e.trim().toLowerCase()).filter(Boolean);
  return Array.from(new Set(cleaned));
}

/**
 * Strict check: returns true only if the input is exactly one valid email
 * with no extra characters or whitespace. Use this to validate stored data.
 */
export function isSingleValidEmail(text: string | null | undefined): boolean {
  if (!text) return false;
  const trimmed = text.trim();
  if (trimmed.length === 0) return false;
  if (/\s/.test(trimmed)) return false;
  const matches = trimmed.match(EMAIL_REGEX);
  return matches?.length === 1 && matches[0] === trimmed;
}

/**
 * Which "required" fields are missing on a PP record?
 * Required = PayPalAccount.password + PayPalAccount.twoFa + ≥1 PayPalEmail.
 */
export type MissingPPField = "password" | "twoFa" | "email";

export interface PPCompletenessInput {
  hasPassword?: boolean;
  hasTwoFa?: boolean;
  emailCount?: number;
}

export function getMissingFields(pp: PPCompletenessInput): MissingPPField[] {
  const missing: MissingPPField[] = [];
  if (!pp.hasPassword) missing.push("password");
  if (!pp.hasTwoFa) missing.push("twoFa");
  if (!pp.emailCount || pp.emailCount < 1) missing.push("email");
  return missing;
}
