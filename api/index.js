// Vercel entry point.
//
// On Vercel there is no long-running server: every route is rewritten here (see
// vercel.json) and this function is invoked once per request. src/index.js is
// still the entry point everywhere else (local dev, Railway).
//
// The app and the database connection live at module scope, so a warm instance
// reuses both and only a cold start pays for connecting.

import { createApp } from "../src/app.js";
import { connectDb, isDbReady } from "../src/db.js";

const app = createApp();

// How long a cold request waits for MongoDB before the app answers it with its
// usual 503 database_unavailable. Well under the function's maxDuration.
const CONNECT_WAIT_MS = 8000;

let connecting = null;

function waitForDb() {
  // connectDb retries with backoff and only resolves once connected, so it is
  // started once and later requests share the same attempt.
  connecting ??= connectDb();

  let timer;
  const timeout = new Promise((resolve) => {
    timer = setTimeout(resolve, CONNECT_WAIT_MS);
  });
  return Promise.race([connecting, timeout]).finally(() => clearTimeout(timer));
}

export default async function handler(req, res) {
  if (!isDbReady()) await waitForDb();
  return app(req, res);
}
