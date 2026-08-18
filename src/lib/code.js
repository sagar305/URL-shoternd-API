// 10-character short codes.
//
// Base62 over crypto-strong bytes: 62^10 is about 8.4x10^17 codes, so even at
// millions of links the chance of two colliding is negligible — and the unique
// index on `code` plus a retry in the store makes a collision harmless anyway.

import { randomBytes, createHash } from "node:crypto";

const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
export const CODE_LENGTH = 10;

// 62 * 4 = 248. Bytes at or above this are rejected rather than folded with a
// modulo, which would quietly make the first 8 letters more likely than the rest.
const CEILING = 248;

export function generateCode(length = CODE_LENGTH) {
  let out = "";
  while (out.length < length) {
    for (const byte of randomBytes(length * 2)) {
      if (byte >= CEILING) continue;
      out += ALPHABET[byte % ALPHABET.length];
      if (out.length === length) break;
    }
  }
  return out;
}

/** The edit token is a second, independent code — never the public one. */
export function generateEditToken() {
  return generateCode(CODE_LENGTH);
}

export function isValidCode(value) {
  return typeof value === "string" && new RegExp(`^[A-Za-z0-9]{${CODE_LENGTH}}$`).test(value);
}

/** Tokens are stored hashed, so a database dump does not hand over edit rights. */
export function hashToken(token) {
  return createHash("sha256").update(token).digest("hex");
}

/** Identifies an identical payload so the same document reuses its code. */
export function hashPayload(payload) {
  return createHash("sha256").update(payload).digest("hex");
}
