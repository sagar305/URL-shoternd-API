// Vercel entry point. Vercel runs this as a serverless function instead of
// src/index.js, which calls app.listen() and is meant for Railway / long-lived
// hosts. Every path is rewritten here by vercel.json.

import { createApp } from "../src/app.js";
import { ensureDb } from "../src/db.js";

const app = createApp();

export default async function handler(req, res) {
  // Never throws: on failure /health and /api/links report the reason
  // (503 database_unavailable) instead of Vercel returning a bare 500.
  await ensureDb();
  return app(req, res);
}
