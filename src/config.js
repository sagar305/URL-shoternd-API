// Environment configuration, read once at startup so a missing value fails
// loudly here rather than on the first request that happens to need it.

const DAY_MS = 24 * 60 * 60 * 1000;

function required(name) {
  const value = process.env[name];
  if (!value) throw new Error(`Missing required environment variable: ${name}`);
  return value;
}

function list(name) {
  return (process.env[name] ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter(Boolean);
}

export const config = {
  port: Number(process.env.PORT ?? 8080),
  mongoUri: process.env.NODE_ENV === "test" ? "" : required("MONGODB_URI"),

  // The shared secret the Setu site's server-side proxy sends as x-api-key.
  // Every endpoint requires it: nothing here is meant to be reachable from a
  // browser directly, which is what keeps this from being an open shortener.
  apiKey: process.env.NODE_ENV === "test" ? "test-key" : required("API_KEY"),

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

export { DAY_MS };
