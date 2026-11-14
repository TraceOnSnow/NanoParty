import { createHash, randomBytes, timingSafeEqual } from "node:crypto";

/** 192 bits of entropy, URL-safe. Used for invite links and player session tokens. */
export const randomToken = () => randomBytes(24).toString("base64url");

/** Short random id for database rows (not a credential). */
export const newId = (prefix: string) => `${prefix}_${randomBytes(9).toString("base64url")}`;

export const sha256 = (value: string) => createHash("sha256").update(value).digest("hex");

export function safeEqual(a: string, b: string): boolean {
  const ha = createHash("sha256").update(a).digest();
  const hb = createHash("sha256").update(b).digest();
  return timingSafeEqual(ha, hb);
}
