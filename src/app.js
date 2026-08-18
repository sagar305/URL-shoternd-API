// Express app as a factory so tests can mount it without opening a port or
// touching the real database.

import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { config } from "./config.js";
import { requireApiKey, checkOrigin } from "./middleware/auth.js";
import { errorHandler, notFound } from "./middleware/errors.js";
import { linksRouter } from "./routes/links.js";

export function createApp() {
  const app = express();

  // Railway terminates TLS upstream, so the client IP the rate limiter keys on
  // only arrives via X-Forwarded-For.
  app.set("trust proxy", 1);

  app.disable("x-powered-by");
  app.use(helmet());
  app.use(compression());
  app.use(
    cors({
      origin: config.allowedOrigins.length > 0 ? config.allowedOrigins : false,
      methods: ["GET", "POST", "PUT"],
      allowedHeaders: ["Content-Type", "x-api-key"],
    })
  );

  // Slightly above the payload cap so an oversized body is rejected by the
  // route with a clear error rather than by the parser with a vague one.
  app.use(express.json({ limit: config.maxPayloadBytes + 16 * 1024 }));

  app.get("/health", (_req, res) => res.json({ ok: true }));

  app.use(
    "/api/links",
    rateLimit({
      windowMs: 60 * 1000,
      limit: 120,
      standardHeaders: "draft-7",
      legacyHeaders: false,
    }),
    checkOrigin,
    requireApiKey,
    linksRouter
  );

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
