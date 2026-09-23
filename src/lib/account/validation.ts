import { isBotName } from "../bot-identity";

export class AccountError extends Error {
  constructor(public code: string, message: string, public status = 400) {
    super(message);
    this.name = "AccountError";
  }
}

export function usernameValue(raw: unknown): string {
  if (typeof raw !== "string" || !/^[a-zA-Z0-9]{3,18}$/.test(raw.trim())) {
    throw new AccountError("USERNAME", "Use 3 to 18 letters or numbers for your username.");
  }
  return raw.trim().toLowerCase();
}

/** Friend lookup accepts an optional @, but never repairs a mistyped name. */
export function usernameForLookup(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const value = raw.trim().replace(/^@/, "");
  return /^[a-zA-Z0-9]{3,18}$/.test(value) ? value.toLowerCase() : null;
}

export function passwordValue(raw: unknown, isNew = true): string {
  if (typeof raw !== "string" || raw.length > 128 || raw.length < (isNew ? 8 : 1)) {
    throw new AccountError("PASSWORD", isNew ? "Use 8 to 128 characters for your password." : "Enter your password.");
  }
  return raw; // Spaces and capitalization are part of the password.
}

export function displayNameValue(raw: unknown): string {
  if (typeof raw !== "string") throw new AccountError("DISPLAY_NAME", "Enter your display name.");
  const name = raw.trim().replace(/\s+/g, " ");
  if (!name || name.length > 18 || /[\u0000-\u001f\u007f]/.test(name)) {
    throw new AccountError("DISPLAY_NAME", "Use 1 to 18 characters for your display name.");
  }
  if (isBotName(name)) {
    throw new AccountError("DISPLAY_NAME", "That name belongs to a house bot. Choose another display name.");
  }
  return name;
}
