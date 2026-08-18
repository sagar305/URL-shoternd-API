import { Router } from "express";
import { config } from "../config.js";
import { isValidCode } from "../lib/code.js";
import { createLink, readLink, updateLink, UPDATE_RESULT } from "../store.js";

export const linksRouter = Router();

const KINDS = new Set(["doc", "menu"]);

/**
 * Payloads are compressed text, so bytes and characters diverge for anything
 * non-ASCII. The limit is on bytes, which is what actually costs storage.
 */
function payloadProblem(payload) {
  if (typeof payload !== "string" || payload.length === 0) return "payload_required";
  if (Buffer.byteLength(payload, "utf8") > config.maxPayloadBytes) return "payload_too_large";
  return null;
}

function shortUrl(code) {
  return `${config.shortUrlBase}/${code}`;
}

linksRouter.post("/", async (req, res, next) => {
  try {
    const { payload, kind = "doc" } = req.body ?? {};

    if (!KINDS.has(kind)) return res.status(400).json({ error: "invalid_kind" });
    const problem = payloadProblem(payload);
    if (problem) {
      return res.status(problem === "payload_too_large" ? 413 : 400).json({ error: problem });
    }

    const result = await createLink({ payload, kind });
    return res.status(result.reused ? 200 : 201).json({
      code: result.code,
      url: shortUrl(result.code),
      expiresAt: result.expiresAt,
      ...(result.editToken ? { editToken: result.editToken } : {}),
    });
  } catch (error) {
    return next(error);
  }
});

linksRouter.get("/:code", async (req, res, next) => {
  try {
    const { code } = req.params;
    if (!isValidCode(code)) return res.status(400).json({ error: "invalid_code" });

    const link = await readLink(code);
    // An expired link has already been swept by the TTL monitor, so "gone" and
    // "never existed" are the same answer here — the viewer says so in one line.
    if (!link) return res.status(404).json({ error: "not_found" });

    return res.json({
      code: link.code,
      kind: link.kind,
      payload: link.payload,
      expiresAt: link.expiresAt,
      updatedAt: link.updatedAt,
    });
  } catch (error) {
    return next(error);
  }
});

linksRouter.put("/:code", async (req, res, next) => {
  try {
    const { code } = req.params;
    const { payload, editToken } = req.body ?? {};

    if (!isValidCode(code)) return res.status(400).json({ error: "invalid_code" });
    if (!isValidCode(editToken ?? "")) return res.status(400).json({ error: "invalid_edit_token" });
    const problem = payloadProblem(payload);
    if (problem) {
      return res.status(problem === "payload_too_large" ? 413 : 400).json({ error: problem });
    }

    const result = await updateLink(code, { payload, editToken });
    if (result.status === UPDATE_RESULT.notFound) {
      return res.status(404).json({ error: "not_found" });
    }
    if (result.status === UPDATE_RESULT.notEditable) {
      return res.status(409).json({ error: "not_editable" });
    }
    if (result.status === UPDATE_RESULT.forbidden) {
      return res.status(403).json({ error: "forbidden" });
    }

    return res.json({
      code: result.link.code,
      url: shortUrl(result.link.code),
      expiresAt: result.link.expiresAt,
    });
  } catch (error) {
    return next(error);
  }
});
