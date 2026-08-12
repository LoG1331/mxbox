# mxbox

Self-hosted email server dashboard — receive mail through a Cloudflare Email Worker, store it in SQLite, and manage everything from a single web UI.

[![npm version](https://img.shields.io/npm/v/@log1331/mxbox)](https://www.npmjs.com/package/@log1331/mxbox)
[![license](https://img.shields.io/npm/l/@log1331/mxbox)](LICENSE)
[![node](https://img.shields.io/badge/node-%3E%3D22-brightgreen)](https://nodejs.org)

## What is mxbox

mxbox is a single-process, self-hosted email server dashboard. Mail for your domains is received by Cloudflare Email Routing, forwarded by a small Cloudflare Email Worker to the mxbox backend over HTTPS, parsed from raw MIME, and stored in SQLite. You browse, search, and administer everything through a dark React dashboard or a Telegram bot.

Key features:

- **Inbound email over HTTP** — authenticated `POST /v1/inbound/email` endpoint that accepts raw MIME from the edge forwarder
- **Web dashboard** — React 19 SPA (Vite + Tailwind 4) with Overview, My Mail, System Mail, Domains, Blocked Senders, Users, Permissions, Admins, and Telegram Bot pages
- **Domain-first permission model** — global super admins, plus per-user permissions scoped to individual domains
- **Mailbox registration** — users claim mailboxes (`email_registers`); "My Mail" only shows mail for mailboxes you registered, and each mailbox can belong to exactly one user
- **System Mail** — admins can read and search all mail across the system (`scope=system`)
- **Blocked senders** — reject mail from unwanted senders at ingest time
- **Telegram bot** — notifications and mailbox commands (`/inbox`, `/newmail`, `/register`, …) configured entirely from the UI
- **Built-in maintenance** — prune old emails and raw MIME, `VACUUM`, and storage statistics from the dashboard
- **Single-file server** — the npm package bundles the backend and the prebuilt frontend into one process; no reverse proxy required

## How it works

```
 Sender ──► Cloudflare Email Routing ──► Email Worker (forwarder)
                                              │  POST raw MIME
                                              │  Authorization: Bearer <token>
                                              ▼
                                         mxbox server
                                      Express 5 + SQLite
                                        ┌──────┴──────┐
                                        ▼             ▼
                                   Web dashboard   Telegram bot
```

The Worker does no business logic at the edge: it POSTs the raw message plus envelope headers to `POST /v1/inbound/email`, authenticated with a bearer token (`INBOUND_AUTH_TOKEN`). All parsing, storage, and access control happen on the server.

## Quick start

Requires Node.js >= 22.

```bash
npx @log1331/mxbox
# or install globally:
npm install -g @log1331/mxbox
mxbox
```

On the first run mxbox:

1. Creates the data directory `~/.local/mxbox/` (override with the `MXBOX_HOME` environment variable)
2. Writes a `.env` there with a random `INBOUND_AUTH_TOKEN` and bootstrap admin credentials
3. Creates the SQLite database at `~/.local/mxbox/mxbox.sqlite`
4. Prints the admin password **exactly once** — save it

Then open <http://localhost:3001> and log in as `admin`.

CLI options (they override `.env`):

```bash
mxbox --port 8080 --host 0.0.0.0
mxbox --help
```

| Option | Default | Description |
| --- | --- | --- |
| `--port <n>` | `3001` | Port to listen on |
| `--host <addr>` | `0.0.0.0` | Listen address |
| `--help` | — | Show usage |

## Set up the email forwarder

Full guide: [docs/FORWARDER.md](docs/FORWARDER.md). In short:

1. Copy the dependency-free Worker source from `docs/FORWARDER.md` into a new Worker project (`src/index.js`) and create a `wrangler.toml` pointing `FORWARD_TARGET_URL` at your server, e.g. `https://mx.example.com/v1/inbound/email`.
2. `npx wrangler secret put FORWARD_AUTH_TOKEN` — must be identical to the server's `INBOUND_AUTH_TOKEN`.
3. `npx wrangler deploy`, then in the Cloudflare dashboard go to **Email → Email Routing → Routing rules** and route your domain (or a catch-all) to the Worker with the **Send to a Worker** action.
4. Verify with `curl https://<worker>.workers.dev/health` and send a real test email.

Your domain's DNS must be managed by Cloudflare for Email Routing to work.

## Configuration

Config lives in `$MXBOX_HOME/.env` (created on first run). Main variables:

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3001` | HTTP port |
| `HOST` | `0.0.0.0` | Listen address |
| `INBOUND_AUTH_TOKEN` | random | Bearer token the forwarder must send to `POST /v1/inbound/email` |
| `BOOTSTRAP_ADMIN_USERNAME` | `admin` | Initial admin username |
| `BOOTSTRAP_ADMIN_PASSWORD` | random | Initial admin password (only applied on first creation) |
| `AUTH_JWT_SECRET` | auto-generated | Secret for signing JWT sessions |
| `CORS_ALLOWED_ORIGINS` | — | Comma-separated origins for cross-origin API access |
| `AUTO_CREATE_DOMAINS_ON_INGEST` | `false` | Auto-register unknown domains when mail arrives |
| `STORE_RAW_MIME` | `true` | Keep the original raw MIME of each message |
| `RAW_MIME_RETENTION_DAYS` | `30` | How long raw MIME is retained |
| `INBOUND_RATE_LIMIT_MAX` | `120` | Rate limit for the inbound endpoint |
| `AUTH_RATE_LIMIT_MAX` | `300` | Rate limit for authenticated API routes |

Notes:

- `BOOTSTRAP_ADMIN_*` only creates the initial admin. If the username already exists, the backend ensures the admin role but does **not** overwrite the password or profile.
- Internal secrets (`AUTH_JWT_SECRET`, `API_KEY_PEPPER`) are generated automatically and stored in SQLite if you don't set them yourself.
- `NEW_SERVER_SQLITE_PATH` can point the database elsewhere; the CLI sets it to `$MXBOX_HOME/mxbox.sqlite` automatically.

## Telegram bot

No env vars needed. Log in as an admin, open the **Telegram Bot** page in the dashboard, paste your bot token (from [@BotFather](https://t.me/BotFather)), and save — the backend stores the config in SQLite, registers the webhook automatically, and retries failed deliveries through a built-in outbox.

Users link their Telegram account to their mxbox user (`users.telegram_id`) and get the same permission model as the web UI. Commands include `/domains`, `/mailboxes`, `/newmail`, `/register <email>`, `/inbox <email>`, `/email <id>`, `/delete <id>`, and `/clear <email>`.

## Development (from source)

```bash
git clone <repo-url> mxbox
cd mxbox
npm install
npm run env:init   # create/update .env with generated secrets
npm run dev        # backend on :3001 + frontend dev server on :3002
```

Default dev login: `admin` / `admin-pass-123` (set by the dev scripts, not used in the packaged CLI).

Useful scripts:

| Script | Description |
| --- | --- |
| `npm run dev` | Run backend + frontend dev servers together |
| `npm run server:dev` | Backend only (watch mode) |
| `npm run frontend:dev` | Vite dev server only |
| `npm run build` | Build the frontend |
| `npm run start` | Production start (serves `frontend/dist`) |
| `npm run build:bundle` | Build the single-file npm bundle |
| `npm test` | Smoke test + OpenAPI validation |
| `npm run server:openapi` | Validate `server/openapi.json` |
| `npm run frontend:lint` | Lint the frontend |

Project layout:

```
bin/        CLI entry point (single-process server + embedded frontend)
bundle/     Prebuilt single-file bundle shipped to npm
server/     Express 5 backend (src/), API.md, openapi.json
frontend/   React 19 + Vite + Tailwind 4 SPA
scripts/    Dev/build/start shell scripts, env generator
docs/       FORWARDER.md — edge forwarder setup guide
```

## API

The API is documented in [server/API.md](server/API.md) (human-readable) and [server/openapi.json](server/openapi.json) (OpenAPI spec). Web clients authenticate with `Authorization: Bearer <sessionToken>`.

Log in:

```bash
curl -X POST http://localhost:3001/v1/auth/login \
  -H "Content-Type: application/json" \
  -d '{"username": "admin", "password": "<password>"}'
# => { "sessionToken": "...", "expiresAt": ..., ... }
```

List your registered-mailbox emails:

```bash
curl "http://localhost:3001/v1/emails?scope=registered&limit=20" \
  -H "Authorization: Bearer <sessionToken>"
```

Admins can use `scope=system` to read all mail. List responses return trimmed `EmailSummary` objects (no full bodies); call `GET /v1/emails/:id` for the complete message.

## Security notes

- Change the bootstrap admin password after the first login; the first-run password is printed once and stored in plaintext in `$MXBOX_HOME/.env` until you rotate it.
- Keep `INBOUND_AUTH_TOKEN` secret — it is the only thing protecting the inbound endpoint. Set it as a Wrangler **secret**, never in `wrangler.toml`.
- The API is rate-limited (`INBOUND_RATE_LIMIT_MAX`, `AUTH_RATE_LIMIT_MAX`) and uses `helmet` security headers; still, put the server behind HTTPS before exposing it publicly.
- The last active admin cannot be disabled or revoked.

## License

[MIT](LICENSE)
