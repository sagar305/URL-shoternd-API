import mongoose from "mongoose";
import { config } from "./config.js";

export async function connectDb(uri = config.mongoUri) {
  mongoose.set("strictQuery", true);
  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 10000,
    // Railway restarts containers freely; a small pool re-establishes quickly.
    maxPoolSize: 10,
  });
  // Without this the TTL and unique indexes only exist on machines where a
  // write happened to create them.
  await mongoose.connection.syncIndexes();
  return mongoose.connection;
}

export async function disconnectDb() {
  await mongoose.disconnect();
}
