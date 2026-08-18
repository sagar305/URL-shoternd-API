import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Keeps config.js from demanding a real MONGODB_URI and API_KEY: the tests
    // mock the model layer and never open a connection.
    env: { NODE_ENV: "test" },
    include: ["tests/**/*.test.js"],
  },
});
