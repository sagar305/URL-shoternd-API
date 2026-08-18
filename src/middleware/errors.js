export function notFound(_req, res) {
  res.status(404).json({ error: "not_found" });
}

// Express needs the unused `next` to recognise this as an error handler.
// eslint-disable-next-line no-unused-vars
export function errorHandler(error, _req, res, _next) {
  // A body over the express.json limit arrives here rather than at the route.
  if (error?.type === "entity.too.large") {
    return res.status(413).json({ error: "payload_too_large" });
  }
  if (error instanceof SyntaxError && "body" in error) {
    return res.status(400).json({ error: "invalid_json" });
  }
  console.error("[shortener]", error);
  return res.status(500).json({ error: "internal_error" });
}
