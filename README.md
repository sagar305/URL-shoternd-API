# Setu URL Shortener API

Short links for the free tools on [setutechnology.com](https://setutechnology.com).

Setu's tools put an entire document — an invoice, a quotation, a fee receipt, a
restaurant menu — inside the URL itself, LZ-compressed into the fragment. That
keeps the data off every server, but it makes links 800–2,900 characters long,
and it caps a QR menu at whatever fits in a QR code.

This service takes that same compressed payload, stores it, and hands back a
**10-character code**. `setutechnology.com/view/aB3xK9mQ2p` replaces the wall of
text, and a QR menu stops being limited by the QR code's byte budget.

Shortening is **opt-in per share** on the site. When it is off, or when the
browser is offline, the tools fall back to the long self-contained link and
nothing is uploaded.

## How it works

```
Browser (Setu tool)
   │  POST /api/short          ← same-origin, no secrets in the browser
   ▼
Next.js proxy (setutechnology.com)
   │  POST /api/links  + x-api-key
   ▼
This service ──► MongoDB Atlas
```

The API key lives only on the Next.js server. Browsers never hold it, which is
what stops this from becoming an open shortener for spam and phishing.

### Records expire on a sliding 180 days

Every link carries an `expiresAt`, and a MongoDB TTL index deletes the document
once that moment passes. **Every read and every edit pushes it 180 days further
out**, so a menu customers still scan stays alive indefinitely while an
abandoned one is collected. Mongo's TTL monitor sweeps roughly once a minute, so
deletion is prompt rather than instantaneous.

### Two kinds of link

| | `doc` | `menu` |
|---|---|---|
| Used by | invoices, receipts, quotations, prescriptions, appointments | published QR menus |
| Mutable | No | Yes, via `editToken` |
| Deduplicated | Yes — identical payload reuses its code | **Never** |

Menus are never deduplicated on purpose. Two restaurants that happen to type an
identical menu must not end up sharing one code and one edit token, or either
could rewrite the other's printed QR.

### The edit token is not the code

A published menu returns two different 10-character strings. The **code** is
public — it is printed on every table's QR, so every customer holds it. The
**editToken** is the credential, stored in the owner's browser and never shown
again. Only its SHA-256 hash is stored here, so a database dump does not hand
over the ability to rewrite anybody's menu.

Losing the token means losing the ability to edit that menu. There is no login
and no recovery — a deliberate consequence of the no-account design.

## Endpoints

Every `/api/links` route requires the `x-api-key` header. `/health` does not.

### `POST /api/links`

```jsonc
// request
{ "payload": "<LZ-compressed string>", "kind": "doc" }   // or "menu"

// 201 created
{ "code": "aB3xK9mQ2p", "url": "https://setutechnology.com/view/aB3xK9mQ2p",
  "expiresAt": "2027-02-14T09:00:00.000Z" }

// 200 — identical document already stored, same code returned
// menus additionally return: "editToken": "Qw7zR2nL5v"
```

Errors: `400 invalid_kind`, `400 payload_required`, `413 payload_too_large`.

### `GET /api/links/:code`

Returns `{ code, kind, payload, expiresAt, updatedAt }` and slides the expiry
forward. `404 not_found` covers both an unknown code and an expired one — from
the caller's side they are the same thing.

### `PUT /api/links/:code`

```jsonc
{ "payload": "<new compressed menu>", "editToken": "Qw7zR2nL5v" }
```

Errors: `403 forbidden` (wrong token), `409 not_editable` (it is a `doc`),
`404 not_found`, `400 invalid_edit_token`.

### `GET /health`

Needs no key, and always answers 200 so it can explain itself:

```jsonc
{ "ok": true, "missingEnv": [], "db": { "status": "connected", "readyState": 1 },
  "uptimeSeconds": 412 }
```

`ok` is false when a required variable is missing or the database is not
connected, with `missingEnv` and `db.error` saying which. Curl this first
whenever the service misbehaves — a platform-level "application failed to
respond" means the container is not running at all, which this endpoint
existing at all is meant to rule out.

## Troubleshooting

**`"error": "connection refused"` in Railway's request log** — the container is
running but nothing is listening on the port the edge routes to. Almost always a
`PORT` mismatch: Railway injects `PORT` to match its target port, so setting
`PORT` yourself as a service variable pins the app somewhere the edge is not
sending traffic. **Delete any `PORT` variable from the Railway service** and
redeploy. The boot log names the port and where it came from, so compare it with
Settings → Networking → target port.

**"Application failed to respond" / a 502 with a `request_id`** — that error page
comes from Railway, not from this service (its errors are always JSON like
`{"error": "..."}`). It means nothing is listening. Check the deploy logs: the
service binds the port before it touches the database, so if it is not listening
the process failed even earlier — usually a build or start-command problem.

**`{"error":"database_unavailable"}`** — the service is up but Atlas is not
reachable. `GET /health` carries the driver's own message in `db.error`. In
order of likelihood: Atlas Network Access does not allow Railway's egress
(allow `0.0.0.0/0` to confirm, then narrow), the database user's password is
wrong or contains unescaped URL characters, or `MONGODB_URI` is missing the
database name. The service retries with backoff and recovers on its own once
the cause is fixed — no redeploy needed.

**`{"error":"unauthorized"}`** — `API_KEY` here and `SHORTENER_API_KEY` on the
Setu site are not the same value.

## Running locally

```bash
npm install
cp .env.example .env      # fill in MONGODB_URI and API_KEY
npm run dev               # http://localhost:8080
npm test
```

Tests mock the model layer, so they need no running MongoDB.

## Deploying

**MongoDB Atlas** — create a cluster and a database user, and allow Railway's
egress in Network Access. The TTL and unique indexes are created automatically
on boot by `syncIndexes()`; nothing needs to be set up by hand.

**Railway** — point a service at this repo. `railway.json` sets the start
command and the health check. Set these service variables:

| Variable | Notes |
|---|---|
| `MONGODB_URI` | Atlas connection string, including the database name |
| `API_KEY` | Same value as `SHORTENER_API_KEY` on the Setu site |
| `SHORT_URL_BASE` | `https://setutechnology.com/view` |
| `ALLOWED_ORIGINS` | Optional; only affects browser-direct calls |
| `LINK_TTL_DAYS` | Defaults to 180 |
| `MAX_PAYLOAD_BYTES` | Defaults to 262144 (256 KB) |

**Do not set `PORT`.** Railway injects it to match the port its edge routes to;
setting it yourself is the most common cause of "connection refused" on an
otherwise healthy container.

Then set `SHORTENER_API_URL` and `SHORTENER_API_KEY` on the Setu site to point
at the deployed service.

## What this service does not do

It never parses a payload. An invoice and a menu are both just opaque compressed
strings here, so a change to a tool's data shape needs no change and no redeploy
on this side. It also stores no view counts — only `lastAccessedAt`, and only
because the sliding expiry needs it.
