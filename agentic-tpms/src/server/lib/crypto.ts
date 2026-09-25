import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import { sql, type SQL } from "drizzle-orm";
import { env } from "../env";

export function sha256Hex(data: string | Uint8Array): string {
  return createHash("sha256").update(data).digest("hex");
}

// ---------------------------------------------------------------- NRIC (PDPA)

export interface NormalisedId {
  kind: "NRIC" | "PASSPORT";
  normalised: string;
}

/**
 * Malaysian MyKad: YYMMDD-PB-###G, 12 digits. The first six must be a real
 * calendar date. Anything else that looks like a travel document (6–15
 * alphanumerics) is treated as a passport number. Returns null when neither.
 */
export function normaliseIdentity(raw: string): NormalisedId | null {
  const compact = raw.replace(/[\s-]/g, "").toUpperCase();
  if (/^\d{12}$/.test(compact)) {
    const yy = Number(compact.slice(0, 2));
    const mm = Number(compact.slice(2, 4));
    const dd = Number(compact.slice(4, 6));
    const year = yy + (yy > 30 ? 1900 : 2000);
    const date = new Date(Date.UTC(year, mm - 1, dd));
    const valid = date.getUTCFullYear() === year && date.getUTCMonth() === mm - 1 && date.getUTCDate() === dd;
    if (!valid) return null;
    return { kind: "NRIC", normalised: compact };
  }
  if (/^[A-Z0-9]{6,15}$/.test(compact) && /[A-Z]/.test(compact)) {
    return { kind: "PASSPORT", normalised: compact };
  }
  return null;
}

/** `******-**-1234` for a MyKad, `*****1234` for a passport. */
export function maskIdentity(id: NormalisedId): string {
  const last4 = id.normalised.slice(-4);
  return id.kind === "NRIC" ? `******-**-${last4}` : `${"*".repeat(Math.max(1, Math.min(8, id.normalised.length - 4)))}${last4}`;
}

/**
 * Keyed hash for dedupe and lookup. A plain SHA-256 of a 12-digit NRIC is
 * brute-forceable in minutes (the space is ~10^12 and mostly dates), so the
 * hash is an HMAC under a server-held pepper.
 */
export function identityHash(id: NormalisedId): string {
  return createHmac("sha256", env().TPMS_NRIC_PEPPER).update(`${id.kind}:${id.normalised}`).digest("hex");
}

/** pgcrypto AES-256 encryption, evaluated in the database (NFR-1). */
export function encryptIdentitySql(id: NormalisedId): SQL {
  return sql`pgp_sym_encrypt(${id.normalised}, ${env().TPMS_MASTER_KEY}, 'cipher-algo=aes256')`;
}

export function decryptIdentitySql(column: SQL): SQL {
  return sql`pgp_sym_decrypt(${column}, ${env().TPMS_MASTER_KEY})`;
}

// ---------------------------------------------------------------- BYOK secrets

function secretKey(): Buffer {
  return createHash("sha256").update(env().TPMS_MASTER_KEY).digest();
}

/** AES-256-GCM, `v1:<iv>:<tag>:<ciphertext>` in base64. */
export function encryptSecret(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", secretKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return ["v1", iv.toString("base64"), tag.toString("base64"), ciphertext.toString("base64")].join(":");
}

export function decryptSecret(sealed: string): string {
  const [version, iv, tag, body] = sealed.split(":");
  if (version !== "v1" || !iv || !tag || !body) throw new Error("Unrecognised secret envelope");
  const decipher = createDecipheriv("aes-256-gcm", secretKey(), Buffer.from(iv, "base64"));
  decipher.setAuthTag(Buffer.from(tag, "base64"));
  return Buffer.concat([decipher.update(Buffer.from(body, "base64")), decipher.final()]).toString("utf8");
}

/** Same shape TrainOS renders: `sk-ant-••••••••••••9a41`. */
export function maskKey(key: string | undefined): string {
  if (!key) return "NOT_SET";
  const trimmed = key.trim();
  if (trimmed.length < 12) return "••••••••••••";
  const prefix = /^(sk-[a-z]+-|sk-|AIza)/.exec(trimmed)?.[1] ?? "";
  return `${prefix}••••••••••••${trimmed.slice(-4)}`;
}

export function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  return ab.length === bb.length && timingSafeEqual(ab, bb);
}
