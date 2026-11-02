import mongoose from "mongoose";

// A rate-limit store for express-rate-limit that keeps its counters in MongoDB.
//
// The default store counts in process memory. That is correct on one long-lived
// server (Railway), but on Vercel every concurrent function instance has its own
// memory, so a client spread across instances would get the limit once per
// instance — and a cold start would reset it to zero. Counting in the database
// the service already uses gives every instance the same number, with no extra
// service to sign up for.
//
// Fixed window: a counter per key per window, which MongoDB's TTL monitor
// deletes once the window has passed (it runs about once a minute, so a stale
// row can outlive its window briefly — the window is part of the _id, so it is
// never read again either way).

const COLLECTION = "ratelimits";

let indexReady = null;

function collection() {
  return mongoose.connection.collection(COLLECTION);
}

function ensureIndex() {
  indexReady ??= collection()
    .createIndex({ expiresAt: 1 }, { expireAfterSeconds: 0 })
    .catch((error) => {
      // Try again on the next hit rather than never.
      indexReady = null;
      throw error;
    });
  return indexReady;
}

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export class MongoRateLimitStore {
  /** @param {{ prefix: string }} options  Distinct per limiter, so their counters never mix. */
  constructor({ prefix }) {
    this.prefix = prefix;
    // Counters are shared across instances, which is the whole point.
    this.localKeys = false;
    this.windowMs = 60 * 1000;
  }

  init(options) {
    this.windowMs = options.windowMs;
  }

  windowStart(now = Date.now()) {
    return Math.floor(now / this.windowMs) * this.windowMs;
  }

  id(key, start) {
    return `${this.prefix}${key}:${start}`;
  }

  async increment(key) {
    // Fail at once while disconnected instead of letting Mongoose buffer the
    // command for ten seconds; the limiter then lets the request through.
    if (mongoose.connection.readyState !== 1) throw new Error("rate limit store: database not connected");
    await ensureIndex();
    const start = this.windowStart();
    const resetTime = new Date(start + this.windowMs);
    const update = () =>
      collection().findOneAndUpdate(
        { _id: this.id(key, start) },
        { $inc: { hits: 1 }, $setOnInsert: { expiresAt: resetTime } },
        { upsert: true, returnDocument: "after" }
      );

    let doc;
    try {
      doc = await update();
    } catch (error) {
      // Two first hits in the same window can race on the upsert; the loser
      // gets a duplicate-key error and simply increments the row that won.
      if (error?.code !== 11000) throw error;
      doc = await update();
    }
    return { totalHits: doc?.hits ?? 1, resetTime };
  }

  async decrement(key) {
    await collection().updateOne({ _id: this.id(key, this.windowStart()) }, { $inc: { hits: -1 } });
  }

  async resetKey(key) {
    await collection().deleteMany({ _id: { $regex: `^${escapeRegex(`${this.prefix}${key}:`)}` } });
  }
}

/**
 * The store a limiter should use: shared in MongoDB on Vercel (or wherever
 * RATE_LIMIT_STORE=mongo), express-rate-limit's in-memory default otherwise.
 */
export function rateLimitStore(prefix) {
  const useMongo = process.env.RATE_LIMIT_STORE
    ? process.env.RATE_LIMIT_STORE === "mongo"
    : Boolean(process.env.VERCEL);
  return useMongo ? new MongoRateLimitStore({ prefix }) : undefined;
}
