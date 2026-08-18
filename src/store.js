// All database access lives here, so the routes stay thin and the TTL is
// refreshed in exactly one place per operation rather than scattered.

import { Link } from "./models/Link.js";
import { config } from "./config.js";
import { generateCode, generateEditToken, hashPayload, hashToken } from "./lib/code.js";

const CODE_ATTEMPTS = 5;

function nextExpiry() {
  return new Date(Date.now() + config.ttlMs);
}

/** MongoServerError 11000 — the unique index on `code` rejected a duplicate. */
function isDuplicateKey(error) {
  return error?.code === 11000;
}

/**
 * Create a link.
 *
 * A "doc" that matches an existing payload byte for byte reuses that code (and
 * has its life extended); a "menu" always gets a fresh code and a fresh edit
 * token. The token is returned exactly once, in plaintext — only its hash is
 * stored, so a lost token cannot be recovered from the database.
 */
export async function createLink({ payload, kind }) {
  if (kind === "doc") {
    const contentHash = hashPayload(payload);
    const existing = await Link.findOneAndUpdate(
      { contentHash, kind: "doc" },
      { $set: { lastAccessedAt: new Date(), expiresAt: nextExpiry() } },
      { new: true }
    );
    if (existing) {
      return { code: existing.code, expiresAt: existing.expiresAt, reused: true };
    }
    return insertWithRetry({ payload, kind, contentHash, editToken: null });
  }

  return insertWithRetry({ payload, kind, contentHash: null, editToken: generateEditToken() });
}

async function insertWithRetry({ payload, kind, contentHash, editToken }) {
  let lastError = null;

  for (let attempt = 0; attempt < CODE_ATTEMPTS; attempt += 1) {
    const code = generateCode();
    try {
      const created = await Link.create({
        code,
        kind,
        payload,
        contentHash,
        editTokenHash: editToken ? hashToken(editToken) : null,
        lastAccessedAt: new Date(),
        expiresAt: nextExpiry(),
      });
      return {
        code: created.code,
        expiresAt: created.expiresAt,
        reused: false,
        ...(editToken ? { editToken } : {}),
      };
    } catch (error) {
      // A duplicate code is worth another roll of the dice; anything else is a
      // real failure and should surface immediately.
      if (!isDuplicateKey(error)) throw error;
      lastError = error;
    }
  }

  throw lastError ?? new Error("Could not allocate a unique code");
}

/**
 * Read a link and slide its expiry forward. Returns null when the code is
 * unknown — which, thanks to the TTL, is also what an expired link looks like.
 */
export async function readLink(code) {
  return Link.findOneAndUpdate(
    { code },
    { $set: { lastAccessedAt: new Date(), expiresAt: nextExpiry() } },
    { new: true }
  );
}

export const UPDATE_RESULT = {
  ok: "ok",
  notFound: "not_found",
  notEditable: "not_editable",
  forbidden: "forbidden",
};

/** Replace a published menu's payload, keeping the code the printed QR points at. */
export async function updateLink(code, { payload, editToken }) {
  const link = await Link.findOne({ code }).select("+editTokenHash");
  if (!link) return { status: UPDATE_RESULT.notFound };
  if (link.kind !== "menu" || !link.editTokenHash) return { status: UPDATE_RESULT.notEditable };
  if (link.editTokenHash !== hashToken(editToken)) return { status: UPDATE_RESULT.forbidden };

  link.payload = payload;
  link.lastAccessedAt = new Date();
  link.expiresAt = nextExpiry();
  await link.save();

  return { status: UPDATE_RESULT.ok, link };
}
