// Two gates, in order of how much they are actually worth.
//
// 1. The API key. This is the real one. Requests reach this service only from
//    the Setu site's own server-side proxy, which holds the key; a browser
//    never sees it, so the shortener cannot be driven by the public.
// 2. The Origin allowlist. Only meaningful for requests that carry an Origin
//    header at all, and forgeable by any non-browser client — so it narrows
//    browser misuse and nothing more. Never the sole check.

import { timingSafeEqual } from "node:crypto";
import { config } from "../config.js";

function safeEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

export function requireApiKey(req, res, next) {
  const presented = req.get("x-api-key");
  if (!presented || !safeEqual(presented, config.apiKey)) {
    return res.status(401).json({ error: "unauthorized" });
  }
  return next();
}

export function checkOrigin(req, res, next) {
  const origin = req.get("origin");
  // Server-to-server calls send no Origin at all; that is the normal path.
  if (!origin || config.allowedOrigins.length === 0) return next();
  if (config.allowedOrigins.includes(origin)) return next();
  return res.status(403).json({ error: "origin_not_allowed" });
}
