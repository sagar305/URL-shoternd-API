import { beforeEach, describe, expect, it, vi } from "vitest";
import { createFakeLinkModel } from "./fakeLinkModel.js";

const fake = createFakeLinkModel();
vi.mock("../src/models/Link.js", () => ({ get Link() { return fake; } }));

const { createLink, readLink, updateLink, UPDATE_RESULT } = await import("../src/store.js");
const { hashToken } = await import("../src/lib/code.js");

beforeEach(() => {
  fake.rows.length = 0;
});

describe("creating documents", () => {
  it("mints a ten-character code and an expiry about 180 days out", async () => {
    const result = await createLink({ payload: "abc", kind: "doc" });

    expect(result.code).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(result.reused).toBe(false);

    const days = (result.expiresAt.getTime() - Date.now()) / 86400000;
    expect(days).toBeGreaterThan(179.9);
    expect(days).toBeLessThan(180.1);
  });

  it("reuses the code when the same document is shared twice", async () => {
    const first = await createLink({ payload: "same-invoice", kind: "doc" });
    const second = await createLink({ payload: "same-invoice", kind: "doc" });

    expect(second.code).toBe(first.code);
    expect(second.reused).toBe(true);
    expect(fake.rows).toHaveLength(1);
  });

  it("gives a different document a different code", async () => {
    const first = await createLink({ payload: "invoice-one", kind: "doc" });
    const second = await createLink({ payload: "invoice-two", kind: "doc" });

    expect(second.code).not.toBe(first.code);
    expect(fake.rows).toHaveLength(2);
  });

  it("hands a document no edit token — documents are immutable", async () => {
    const result = await createLink({ payload: "abc", kind: "doc" });
    expect(result.editToken).toBeUndefined();
  });
});

describe("creating menus", () => {
  it("returns an edit token that differs from the public code", async () => {
    const result = await createLink({ payload: "menu", kind: "menu" });

    expect(result.editToken).toMatch(/^[A-Za-z0-9]{10}$/);
    expect(result.editToken).not.toBe(result.code);
  });

  it("stores only the hash of the token, never the token itself", async () => {
    const result = await createLink({ payload: "menu", kind: "menu" });
    const [row] = fake.rows;

    expect(row.editTokenHash).toBe(hashToken(result.editToken));
    expect(JSON.stringify(row)).not.toContain(result.editToken);
  });

  it("never deduplicates two identical menus", async () => {
    // Two restaurants typing the same menu must not end up sharing one code and
    // one edit token — either could then rewrite the other's printed QR.
    const first = await createLink({ payload: "identical", kind: "menu" });
    const second = await createLink({ payload: "identical", kind: "menu" });

    expect(second.code).not.toBe(first.code);
    expect(second.editToken).not.toBe(first.editToken);
    expect(fake.rows).toHaveLength(2);
  });
});

describe("reading", () => {
  it("returns null for an unknown code", async () => {
    expect(await readLink("Aaaaaaaaaa")).toBeNull();
  });

  it("slides the expiry forward on every view", async () => {
    const { code } = await createLink({ payload: "abc", kind: "doc" });

    // Pretend the link has been sitting unused for 179 days.
    const stale = new Date(Date.now() + 86400000);
    fake.rows[0].expiresAt = stale;

    const read = await readLink(code);
    expect(read.expiresAt.getTime()).toBeGreaterThan(stale.getTime());
  });
});

describe("updating a menu", () => {
  it("replaces the payload while keeping the code the QR points at", async () => {
    const created = await createLink({ payload: "old-menu", kind: "menu" });

    const result = await updateLink(created.code, {
      payload: "new-menu",
      editToken: created.editToken,
    });

    expect(result.status).toBe(UPDATE_RESULT.ok);
    expect(result.link.code).toBe(created.code);
    expect(result.link.payload).toBe("new-menu");
  });

  it("refuses a wrong edit token", async () => {
    const created = await createLink({ payload: "old-menu", kind: "menu" });

    const result = await updateLink(created.code, {
      payload: "hacked",
      editToken: "WrongToken",
    });

    expect(result.status).toBe(UPDATE_RESULT.forbidden);
    expect(fake.rows[0].payload).toBe("old-menu");
  });

  it("refuses the public code used as an edit token", async () => {
    // The code is printed on every table's QR. If it doubled as the token, any
    // diner who scanned the menu could rewrite the restaurant's prices.
    const created = await createLink({ payload: "old-menu", kind: "menu" });

    const result = await updateLink(created.code, {
      payload: "free food",
      editToken: created.code,
    });

    expect(result.status).toBe(UPDATE_RESULT.forbidden);
    expect(fake.rows[0].payload).toBe("old-menu");
  });

  it("refuses to edit a document", async () => {
    const created = await createLink({ payload: "invoice", kind: "doc" });

    const result = await updateLink(created.code, {
      payload: "altered invoice",
      editToken: "AaaaaaaaaA",
    });

    expect(result.status).toBe(UPDATE_RESULT.notEditable);
    expect(fake.rows[0].payload).toBe("invoice");
  });

  it("reports an unknown code as not found", async () => {
    const result = await updateLink("Aaaaaaaaaa", {
      payload: "x",
      editToken: "Bbbbbbbbbb",
    });
    expect(result.status).toBe(UPDATE_RESULT.notFound);
  });
});
