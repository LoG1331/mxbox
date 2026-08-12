# server

New Express backend for the forward-only mail worker with domain-first handling on async SQLite.

## Goals

- Receive raw MIME from the email forwarder (Cloudflare Email Worker, see `docs/FORWARDER.md`)
- Auth via `username + password + JWT session`
- Support `telegramId` and `apiKey` on users
- Permission model based on `domain`, not the old account style
- Regular users can only monitor mail belonging to mailboxes claimed in `email_registers`

## Documentation

- Human docs: `server/API.md`
- Machine-readable spec: `server/openapi.json`

## Main env vars

- `HOST=0.0.0.0`
- `PORT=3001`
- `NEW_SERVER_SQLITE_PATH=/abs/path/to/new-server.sqlite`
- `INBOUND_AUTH_TOKEN=...`
- `BOOTSTRAP_ADMIN_USERNAME=admin`
- `BOOTSTRAP_ADMIN_PASSWORD=...`
- `CORS_ALLOWED_ORIGINS=https://app.example.com,http://localhost:5173`
- `AUTO_CREATE_DOMAINS_ON_INGEST=false`
- `STORE_RAW_MIME=true`
- `RAW_MIME_RETENTION_DAYS=30`

`AUTH_JWT_SECRET` and `API_KEY_PEPPER` can still be set if you want to manage internal secrets yourself. If left empty, the backend generates its own secrets and stores them in SQLite; `INBOUND_AUTH_TOKEN` is not reused for user/session auth.

## Scripts

- `npm run build`
- `npm run env:init`
- `npm run start`
- `npm run server:dev`
- `npm run server:start`
- `npm run server:test`
- `npm run server:openapi`
- `npm test`

## Route Summary

- `GET /health`
- `POST /v1/inbound/email`
- `POST /v1/auth/login`
- `POST /v1/auth/logout`
- `POST /v1/auth/refresh`
- `GET /v1/auth/me`
- `PATCH /v1/auth/me`
- `POST /v1/auth/me/password`
- `POST /v1/auth/me/api-key/rotate`
- `GET|POST /v1/users`
- `GET|PATCH /v1/users/:userId`
- `POST /v1/users/:userId/api-key/rotate`
- `GET|POST /v1/admins`
- `DELETE /v1/admins/:userId`
- `GET|POST /v1/permissions`
- `GET|DELETE /v1/permissions/:permissionId`
- `GET|POST /v1/domains`
- `GET|DELETE /v1/domains/:domain`
- `GET|POST /v1/email-registers`
- `GET /v1/email-registers/new-mail` (session/API key; users limited to domains they have permission on, admins across all `active` domains)
- `DELETE /v1/email-registers/:registrationId`
- `GET /v1/emails`
- `POST /v1/emails/bulk-delete`
- `GET|DELETE /v1/emails/:id`
- `GET|DELETE /v1/inboxes/:emailAddress`
- `POST /v1/maintenance/prune-raw-mime`
- `GET /v1/maintenance/storage`
- `POST /v1/maintenance/prune-emails`
- `GET|PATCH /v1/system/telegram`
- `POST /v1/system/telegram/commands/register`
- `POST /v1/telegram/webhook` when Telegram bot enabled

## Telegram Bot

The bot maps Telegram sender ids to `users.telegram_id` and uses the existing permission/mailbox registration model.
Admins configure the bot from the frontend via `GET|PATCH /v1/system/telegram` and can re-register commands via `POST /v1/system/telegram/commands/register`. The backend will:

- store the token + webhook secret in SQLite
- reload the runtime immediately after saving
- auto-register the webhook when the bot is enabled
- keep a retry outbox in SQLite if Telegram delivery fails

Commands:

- `/start`
- `/help`
- `/domains`
- `/mailboxes`
- `/newmail [domain]`
- `/register <email>`
- `/unregister <email>`
- `/inbox <email>`
- `/email <id>`
- `/delete <id>`
- `/clear <email>`

## Notes

- `npm run env:init` creates/updates `.env` at the repo root with initial secrets; `npm run start` auto-sources `.env` if the file exists
- In production, `server` serves the frontend build from `frontend/dist` if that directory exists
- `GET /v1/auth/me` is the best entrypoint for the frontend after login
- `GET /v1/domains` accurately reflects the domains the user has permission on
- `GET /v1/emails?scope=registered` is always locked to the caller's registered mailboxes, even for admins
- `GET /v1/emails?scope=system` is admin-only, for reading all system mail
- `GET /v1/emails?search=term` supports multiple terms, matching subject/body, stored mail metadata, and `raw_mime` if it is still retained
- `GET /v1/emails` and `GET /v1/inboxes/:emailAddress` for regular users are gated by `email_registers`
- A mailbox can only be registered by exactly one user across the whole system
- `BOOTSTRAP_ADMIN_*` should only be used to create the initial admin; if the username already exists, the backend only ensures the admin role and does not overwrite the existing password/profile
- `POST /v1/domains` and `POST /v1/permissions` are create-only; upsert is gone
- `DELETE /v1/domains/:domain` cascades and deletes the `permissions`, `emails`, and `email_registers` of that domain
- `DELETE /v1/permissions/:permissionId` by a regular user also cleans up that domain's registrations and pending Telegram outbox entries
- The last `active admin` cannot be disabled or revoked
- `GET /v1/email-registers/new-mail` works with a session token or an API key; regular users can only generate on domains they have permission on, admins across all `active` domains
- `GET /v1/maintenance/storage` returns the current SQLite size (`sqlite`, `-wal`, `-shm`) and the total size of the directory containing the DB
- `POST /v1/maintenance/prune-emails` supports `dryRun`, `domain`, `olderThanDays`, `limit` to prune old mail in batches and will auto-`VACUUM` right after a real deletion run
- The old service/group-address model is gone from the new backend
- The Telegram webhook is registered/re-registered when an admin saves the bot config; if reload fails, the Telegram config rolls back to the previous state
- Telegram notifications go through the SQLite outbox and retry in the background if delivery fails
