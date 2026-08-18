import { beforeEach, describe, expect, it, vi } from "vitest";
import request from "supertest";
import { createFakeLinkModel } from "./fakeLinkModel.js";

const fake = createFakeLinkModel();
vi.mock("../src/models/Link.js", () => ({ get Link() { return fake; } }));

const { createApp } = await import("../src/app.js");
const { config } = await import("../src/config.js");

const app = createApp();
const auth = (req) => req.set("x-api-key", config.apiKey);

beforeEach(() => {
  fake.rows.length = 0;
});

describe("health", () => {
  it("needs no key", async () => {
    await request(app).get("/health").expect(200, { ok: true });
  });
});

describe("authentication", () => {
  it("rejects a request with no key", async () => {
    await request(app).post("/api/links").send({ payload: "x" }).expect(401);
  });

  it("rejects a wrong key", async () => {
    await request(app)
      .post("/api/links")
      .set("x-api-key", "not-the-key")
      .send({ payload: "x" })
      .expect(401);
  });

  it("rejects a key of a different length without leaking that fact", async () => {
    const response = await request(app)
      .post("/api/links")
      .set("x-api-key", "a")
      .send({ payload: "x" });

    expect(response.status).toBe(401);
    expect(response.body).toEqual({ error: "unauthorized" });
  });
});

describe("POST /api/links", () => {
  it("creates a link and returns a full short URL", async () => {
    const response = await auth(request(app).post("/api/links")).send({
      payload: "compressed-invoice",
      kind: "doc",
    });

    expect(response.status).toBe(201);
    expect(response.body.code).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(response.body.url).toBe(`${config.shortUrlBase}/${response.body.code}`);
    expect(response.body.expiresAt).toBeTruthy();
  });

  it("answers 200 and the same code when the document is already stored", async () => {
    const first = await auth(request(app).post("/api/links")).send({ payload: "dup", kind: "doc" });
    const second = await auth(request(app).post("/api/links")).send({ payload: "dup", kind: "doc" });

    expect(first.status).toBe(201);
    expect(second.status).toBe(200);
    expect(second.body.code).toBe(first.body.code);
  });

  it("returns an edit token for a menu and none for a document", async () => {
    const menu = await auth(request(app).post("/api/links")).send({ payload: "m", kind: "menu" });
    const doc = await auth(request(app).post("/api/links")).send({ payload: "d", kind: "doc" });

    expect(menu.body.editToken).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(doc.body.editToken).toBeUndefined();
  });

  it("rejects an unknown kind", async () => {
    await auth(request(app).post("/api/links"))
      .send({ payload: "x", kind: "prescription" })
      .expect(400, { error: "invalid_kind" });
  });

  it("rejects an empty payload", async () => {
    await auth(request(app).post("/api/links")).send({ kind: "doc" }).expect(400, {
      error: "payload_required",
    });
  });

  it("rejects a payload over the cap", async () => {
    const tooBig = "a".repeat(config.maxPayloadBytes + 1);
    await auth(request(app).post("/api/links"))
      .send({ payload: tooBig, kind: "doc" })
      .expect(413, { error: "payload_too_large" });
  });

  it("accepts a payload exactly at the cap", async () => {
    const exact = "a".repeat(config.maxPayloadBytes);
    await auth(request(app).post("/api/links")).send({ payload: exact, kind: "doc" }).expect(201);
  });

  it("measures the cap in bytes, not characters", async () => {
    // Three bytes per character in UTF-8: a menu in Devanagari must not slip
    // past a limit that only counted string length.
    const multibyte = "म".repeat(config.maxPayloadBytes);
    await auth(request(app).post("/api/links"))
      .send({ payload: multibyte, kind: "doc" })
      .expect(413, { error: "payload_too_large" });
  });
});

describe("GET /api/links/:code", () => {
  it("returns the stored payload", async () => {
    const created = await auth(request(app).post("/api/links")).send({
      payload: "compressed",
      kind: "doc",
    });

    const response = await auth(request(app).get(`/api/links/${created.body.code}`)).expect(200);
    expect(response.body.payload).toBe("compressed");
    expect(response.body.kind).toBe("doc");
  });

  it("never returns the edit token hash", async () => {
    const created = await auth(request(app).post("/api/links")).send({
      payload: "m",
      kind: "menu",
    });

    const response = await auth(request(app).get(`/api/links/${created.body.code}`)).expect(200);
    expect(JSON.stringify(response.body)).not.toContain("editToken");
  });

  it("404s an unknown code", async () => {
    await auth(request(app).get("/api/links/Aaaaaaaaaa")).expect(404, { error: "not_found" });
  });

  it("400s a malformed code", async () => {
    await auth(request(app).get("/api/links/nope")).expect(400, { error: "invalid_code" });
  });
});

describe("PUT /api/links/:code", () => {
  async function publishMenu(payload = "old") {
    const response = await auth(request(app).post("/api/links")).send({ payload, kind: "menu" });
    return response.body;
  }

  it("updates the menu behind the same code", async () => {
    const menu = await publishMenu();

    await auth(request(app).put(`/api/links/${menu.code}`))
      .send({ payload: "new", editToken: menu.editToken })
      .expect(200);

    const read = await auth(request(app).get(`/api/links/${menu.code}`));
    expect(read.body.payload).toBe("new");
  });

  it("403s the public code presented as the edit token", async () => {
    const menu = await publishMenu();

    await auth(request(app).put(`/api/links/${menu.code}`))
      .send({ payload: "hacked", editToken: menu.code })
      .expect(403, { error: "forbidden" });
  });

  it("409s an attempt to edit a document", async () => {
    const doc = await auth(request(app).post("/api/links")).send({ payload: "inv", kind: "doc" });

    await auth(request(app).put(`/api/links/${doc.body.code}`))
      .send({ payload: "altered", editToken: "AaaaaaaaaA" })
      .expect(409, { error: "not_editable" });
  });

  it("400s a malformed edit token", async () => {
    const menu = await publishMenu();

    await auth(request(app).put(`/api/links/${menu.code}`))
      .send({ payload: "new", editToken: "short" })
      .expect(400, { error: "invalid_edit_token" });
  });
});
