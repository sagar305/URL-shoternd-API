// Environment configuration.
//
// Nothing here throws. A misconfigured service that refuses to start is
// invisible from outside — the platform just reports a 502 with no reason —
// so missing values are collected instead and reported on /health, and the
// HTTP server starts either way.

const DAY_MS = 24 * 60 * 60 * 1000;

const isTest = process.env.NODE_ENV === "test";

function list(name) {
  return (process.env[name] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  mongoUri: process.env.MONGODB_URI ?? "",

  // The shared secret the Setu site's server-side proxy sends as x-api-key.
  // Every endpoint requires it: nothing here is meant to be reachable from a
  // browser directly, which is what keeps this from being an open shortener.
  apiKey: process.env.API_KEY ?? (isTest ? "test-key" : ""),

  // Checked only when a request actually carries an Origin header (i.e. it came
  // from a browser). Defence in depth behind the API key, never instead of it —
  // Origin is trivially forged by anything that is not a browser.
  allowedOrigins: list("ALLOWED_ORIGINS"),

  // Sliding window: any read or write pushes deletion out this far again.
  ttlMs: Number(process.env.LINK_TTL_DAYS ?? 180) * DAY_MS,

  // Payloads are already LZ-compressed by the tool before they get here.
  maxPayloadBytes: Number(process.env.MAX_PAYLOAD_BYTES ?? 256 * 1024),

  // Where a code turns back into a page. Used to build the returned short URL.
  shortUrlBase: (process.env.SHORT_URL_BASE ?? "https://setutechnology.com/view").replace(/\/+$/, ""),
};

/** Names of required variables that are missing. Empty means fully configured. */
export function missingConfig() {
  if (isTest) return [];
  const missing = [];
  if (!config.mongoUri) missing.push("MONGODB_URI");
  if (!config.apiKey) missing.push("API_KEY");
  return missing;
}

export { DAY_MS };
