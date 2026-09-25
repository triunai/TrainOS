/**
 * Malaysian phone normalisation to E.164.
 *
 * Leads type numbers every way there is: `012-345 6789`, `0123456789`,
 * `60123456789`, `+60 12-345 6789`, `+60 012…` (the trunk 0 kept after the
 * country code), `(03) 2711 1234`. Dedupe and WhatsApp both key on the
 * number, so all of them must collapse to one string: `+60123456789`.
 *
 * Malaysian national significant numbers are 8–10 digits: mobiles `1X`
 * (9–10 digits), Klang Valley landlines `3` + 8 digits, other states 8 digits.
 * A number that cannot be one of those is refused (null), not guessed.
 */
const MY_NSN = /^(1\d{8,9}|3\d{8}|[4-9]\d{7,8})$/;
const INTL = /^[1-9]\d{7,14}$/;

export function normaliseMalaysianPhone(raw: string | null | undefined): string | null {
  if (!raw) return null;
  // Drop an extension ("ext 12", "x12") before stripping punctuation.
  const trimmed = String(raw).trim().replace(/\s*(?:ext\.?|extension|x)\s*\d{1,6}$/i, "");
  const plus = trimmed.startsWith("+");
  let digits = trimmed.replace(/\D/g, "");
  if (!digits) return null;

  if (plus || digits.startsWith("00")) {
    if (!plus) digits = digits.slice(2);
    if (digits.startsWith("60")) return malaysian(digits.slice(2));
    return INTL.test(digits) ? `+${digits}` : null;
  }
  if (digits.startsWith("60") && digits.length >= 10 && MY_NSN.test(stripTrunk(digits.slice(2)))) {
    return malaysian(digits.slice(2));
  }
  if (digits.startsWith("0")) return malaysian(digits);
  // A mobile typed without its trunk 0: "12-345 6789".
  if (/^1\d{8,9}$/.test(digits)) return malaysian(digits);
  return null;
}

function stripTrunk(nsn: string): string {
  return nsn.startsWith("0") ? nsn.slice(1) : nsn;
}

function malaysian(rest: string): string | null {
  const nsn = stripTrunk(rest);
  return MY_NSN.test(nsn) ? `+60${nsn}` : null;
}

/** WhatsApp only reaches mobiles; a Malaysian landline never has it. */
export function isWhatsAppCapable(e164: string | null | undefined): boolean {
  if (!e164) return false;
  if (e164.startsWith("+60")) return /^\+601\d{8,9}$/.test(e164);
  return /^\+[1-9]\d{7,14}$/.test(e164);
}

/** The number to keep from several: the first WhatsApp-capable mobile, else the first number. */
export function bestPhone(numbers: string[]): string | null {
  return numbers.find(isWhatsAppCapable) ?? numbers[0] ?? null;
}

/** Every Malaysian-looking number in free text (email signatures, WhatsApp bodies). */
export function findPhoneNumbers(text: string): string[] {
  const found: string[] = [];
  // Spaces and tabs only: a number never continues onto the next line.
  const pattern = /(?:\+?6?0|\+60[ \t]?)[\d \t\-().]{7,16}\d/g;
  for (const match of text.matchAll(pattern)) {
    const e164 = normaliseMalaysianPhone(match[0]);
    if (e164 && !found.includes(e164)) found.push(e164);
  }
  return found;
}
