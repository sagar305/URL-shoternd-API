// Express app as a factory so tests can mount it without opening a port or
// touching the real database.

import express from "express";
import helmet from "helmet";
import cors from "cors";
import compression from "compression";
import rateLimit from "express-rate-limit";
import { config, missingConfig } from "./config.js";
import { dbState, isDbReady } from "./db.js";
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

  // Always 200, and always says why it is unhappy. A health endpoint that
  // fails when the database does gives the platform nothing to display but a
  // gateway error, which is exactly the situation this is meant to explain.
  app.get("/health", (_req, res) => {
    const missing = missingConfig();
    res.json({
      ok: missing.length === 0 && isDbReady(),
      missingEnv: missing,
      db: dbState(),
      uptimeSeconds: Math.round(process.uptime()),
    });
  });

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
    // Without a database there is nothing this router can do, and Mongoose
    // buffering would otherwise turn it into a slow, unexplained timeout.
    (_req, res, next) =>
      isDbReady()
        ? next()
        : res.status(503).json({ error: "database_unavailable", db: dbState() }),
    linksRouter
  );

  app.use(notFound);
  app.use(errorHandler);

  return app;
}
