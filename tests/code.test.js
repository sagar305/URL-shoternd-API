import { describe, expect, it } from "vitest";
import {
  CODE_LENGTH,
  generateCode,
  generateEditToken,
  hashPayload,
  hashToken,
  isValidCode,
} from "../src/lib/code.js";

describe("short codes", () => {
  it("is ten alphanumeric characters", () => {
    for (let i = 0; i < 200; i += 1) {
      const code = generateCode();
      expect(code).toHaveLength(CODE_LENGTH);
      expect(code).toMatch(/^[A-Za-z0-9]{10}$/);
    }
  });

  it("does not repeat across a large batch", () => {
    const codes = new Set(Array.from({ length: 20000 }, () => generateCode()));
    expect(codes.size).toBe(20000);
  });

  it("spreads across the whole alphabet rather than favouring the first bytes", () => {
    // Guards the rejection sampling in generateCode: a naive `byte % 62` would
    // make the first 8 letters roughly 25% more likely than the rest.
    const counts = new Map();
    for (const char of Array.from({ length: 5000 }, () => generateCode()).join("")) {
      counts.set(char, (counts.get(char) ?? 0) + 1);
    }
    expect(counts.size).toBe(62);

    const frequencies = [...counts.values()];
    const expected = (5000 * CODE_LENGTH) / 62;
    // Generous band — this catches a systematic bias, not sampling noise.
    expect(Math.min(...frequencies)).toBeGreaterThan(expected * 0.8);
    expect(Math.max(...frequencies)).toBeLessThan(expected * 1.2);
  });

  it("validates only ten-character alphanumeric strings", () => {
    expect(isValidCode(generateCode())).toBe(true);
    expect(isValidCode("short")).toBe(false);
    expect(isValidCode("elevenchars")).toBe(false);
    expect(isValidCode("has-dash12")).toBe(false);
    expect(isValidCode(null)).toBe(false);
  });

  it("mints an edit token that is not the public code", () => {
    expect(generateEditToken()).not.toBe(generateCode());
    expect(isValidCode(generateEditToken())).toBe(true);
  });
});

describe("hashing", () => {
  it("hashes a token to something that is not the token", () => {
    const token = generateEditToken();
    expect(hashToken(token)).not.toBe(token);
    expect(hashToken(token)).toBe(hashToken(token));
  });

  it("gives identical payloads the same hash and different ones different hashes", () => {
    expect(hashPayload("abc")).toBe(hashPayload("abc"));
    expect(hashPayload("abc")).not.toBe(hashPayload("abd"));
  });
});
