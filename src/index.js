import { createApp } from "./app.js";
import { config } from "./config.js";
import { connectDb, disconnectDb } from "./db.js";

async function main() {
  await connectDb();
  const server = createApp().listen(config.port, () => {
    console.log(`[shortener] listening on ${config.port}`);
  });

  // Railway sends SIGTERM on redeploy; finish in-flight requests and let go of
  // the Mongo connection rather than being killed mid-write.
  for (const signal of ["SIGTERM", "SIGINT"]) {
    process.on(signal, () => {
      server.close(async () => {
        await disconnectDb();
        process.exit(0);
      });
    });
  }
}

main().catch((error) => {
  console.error("[shortener] failed to start", error);
  process.exit(1);
});
