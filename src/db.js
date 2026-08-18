import mongoose from "mongoose";
import { config } from "./config.js";

// Connection state, readable by /health so a database problem shows up as a
// sentence rather than as an unexplained gateway error.
const state = { status: "idle", error: null, since: null };

export function dbState() {
  return {
    status: state.status,
    // readyState is the authority once a connection exists; `status` also
    // covers the window before the first attempt and any retry backoff.
    readyState: mongoose.connection.readyState,
    error: state.error,
    since: state.since,
  };
}

export function isDbReady() {
  return mongoose.connection.readyState === 1;
}

async function attempt(uri) {
  mongoose.set("strictQuery", true);
  // Fail a query fast instead of buffering it for ten seconds when the
  // connection is down — the route can then say so straight away.
  mongoose.set("bufferCommands", false);

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    // Railway restarts containers freely; a small pool re-establishes quickly.
    maxPoolSize: 10,
  });

  // Without this the TTL and unique indexes only exist on machines where a
  // write happened to create them.
  await mongoose.connection.syncIndexes();
}

/**
 * Connect, retrying with backoff forever rather than exiting.
 *
 * Atlas being briefly unreachable — an IP allowlist not yet saved, a cluster
 * resuming — must not take the whole service down permanently, and must not
 * look like a crash from outside.
 */
export async function connectDb(uri = config.mongoUri) {
  if (!uri) {
    state.status = "unconfigured";
    state.error = "MONGODB_URI is not set";
    return;
  }

  let delayMs = 1000;
  for (;;) {
    state.status = "connecting";
    state.since = new Date().toISOString();
    try {
      await attempt(uri);
      state.status = "connected";
      state.error = null;
      state.since = new Date().toISOString();
      console.log("[shortener] mongodb connected");

      mongoose.connection.on("disconnected", () => {
        state.status = "disconnected";
        console.warn("[shortener] mongodb disconnected");
      });
      mongoose.connection.on("reconnected", () => {
        state.status = "connected";
        console.log("[shortener] mongodb reconnected");
      });
      return;
    } catch (error) {
      state.status = "error";
      state.error = error?.message ?? String(error);
      console.error(`[shortener] mongodb connection failed: ${state.error}`);
      console.error(
        "[shortener] check MONGODB_URI, the database user's password, and that Atlas " +
          "Network Access allows this platform's egress IPs (0.0.0.0/0 while testing)."
      );
      await new Promise((resolve) => setTimeout(resolve, delayMs));
      delayMs = Math.min(delayMs * 2, 30000);
    }
  }
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
