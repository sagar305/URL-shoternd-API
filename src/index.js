import { createApp } from "./app.js";
import { config, missingConfig } from "./config.js";
import { connectDb, disconnectDb } from "./db.js";

// Listen FIRST, then connect.
//
// Doing it the other way round means any database problem stops the process
// from ever binding a port, and the platform can only report "application
// failed to respond" — a 502 with no cause attached. Binding first guarantees
// that /health is always reachable and can say exactly what is wrong.

function main() {
  const missing = missingConfig();
  if (missing.length > 0) {
    console.error(`[shortener] MISSING ENVIRONMENT VARIABLES: ${missing.join(", ")}`);
    console.error("[shortener] the service will start but every request will fail until they are set.");
  }

  // 0.0.0.0 explicitly: container platforms route to the published port and a
  // loopback-only bind would be unreachable from outside.
  const server = createApp().listen(config.port, "0.0.0.0", () => {
    console.log(`[shortener] listening on 0.0.0.0:${config.port}`);
  });

  server.on("error", (error) => {
    console.error("[shortener] server error", error);
  });

  // Retries in the background; never rejects, so a database outage cannot take
  // the HTTP server down with it.
  void connectDb();

  // Railway sends SIGTERM on redeploy; finish in-flight requests and let go of
  // the Mongo connection rather than being killed mid-write.
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      console.log(`[shortener] ${signal} received, shutting down`);
      server.close(async () => {
        await disconnectDb().catch(() => {});
        process.exit(0);
      });
      // Do not hang forever if a connection refuses to close.
      setTimeout(() => process.exit(0), 10000).unref();
    });
  }
}

// A crash here would be invisible from outside, so it is logged loudly and the
// process is left alive for the platform to report on.
process.on("unhandledRejection", (error) => {
  console.error("[shortener] unhandled rejection", error);
});
process.on("uncaughtException", (error) => {
  console.error("[shortener] uncaught exception", error);
});

main();
