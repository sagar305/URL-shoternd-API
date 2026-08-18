// One shortened link.
//
// The payload is opaque here: it is whatever LZ-compressed string the Setu tool
// put in the URL fragment before short links existed, so this service never
// parses an invoice or a menu and does not need to change when a tool's shape
// does.

import mongoose from "mongoose";

const linkSchema = new mongoose.Schema(
  {
    code: { type: String, required: true, unique: true, index: true },

    // "doc"  — one-off share (invoice, receipt, prescription, appointment).
    //          Immutable, and deduplicated by contentHash.
    // "menu" — a published QR menu. Mutable via editToken, and deliberately
    //          never deduplicated: two restaurants that happen to type the same
    //          menu must not end up sharing one code and one edit token.
    kind: { type: String, required: true, enum: ["doc", "menu"] },

    payload: { type: String, required: true },

    // Set for kind "doc" only, so an identical re-share returns the same code.
    contentHash: { type: String, default: null },

    // sha256 of the token handed to the owner once, at creation. Never selected
    // by default so it cannot leak into a read response by accident.
    editTokenHash: { type: String, default: null, select: false },

    lastAccessedAt: { type: Date, default: Date.now },

    // TTL anchor. Every read and every edit pushes it forward, so links people
    // still use stay alive and only abandoned ones are collected.
    expiresAt: { type: Date, required: true },
  },
  { timestamps: true }
);

// expireAfterSeconds 0 means "delete once expiresAt is in the past". Mongo's
// TTL monitor sweeps about once a minute, so deletion is prompt, not instant.
linkSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

// Partial: only documents participate in dedupe, and only they carry a hash.
linkSchema.index(
  { contentHash: 1 },
  { partialFilterExpression: { contentHash: { $type: "string" } } }
);

export const Link = mongoose.models.Link ?? mongoose.model("Link", linkSchema);
