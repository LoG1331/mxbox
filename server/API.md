# server API

This document is for the new frontend. The machine-readable source of truth remains [`server/openapi.json`](./openapi.json).

## Overview

- Dev base URL: `http://127.0.0.1:3001`
- Web auth: `Authorization: Bearer <sessionToken>`
- Content-Type: `application/json` for most routes
- Every response includes a `requestId`
- The frontend should use JWT sessions for the entire web flow

## Current model

- `users`: web login accounts using `username + password`
- `admins`: users with full system privileges
- `domains`: mail domains managed by the system
- `permissions`: permissions per `user + domain + status`
- `email_registers`: specific mailboxes a user has registered to monitor
- `emails`: ingested mail
- `blocked_senders`: blocked sender list, by email or by domain

## Permission rules

- Admins have full rights over every domain, user, and email
- Regular users only see domains granted in `permissions`
- Regular users can only read mail belonging to mailboxes they themselves registered in `email_registers`
- Two users cannot register the same `emailAddress`
- Only admins can manage the blocked sender list

## Error format

Standard error response:

```json
{
  "error": "Human readable message",
  "details": {},
  "requestId": "uuid"
}
```

Common status codes:

- `400`: invalid payload/query/path
- `401`: not logged in, or token invalid/expired
- `403`: insufficient permission
- `404`: record not found
- `409`: business logic conflict

## Auth

### `POST /v1/auth/login`

Body:

```json
{
  "username": "admin",
  "password": "admin-pass-123"
}
```

Main response fields:

- `sessionToken`
- `expiresAt`
- `session`
- `account`

### `POST /v1/auth/logout`

Logs out the current session.

### `POST /v1/auth/refresh`

Renews the JWT session, returns a new `sessionToken`.

### `GET /v1/auth/me`

Main entry point after login.

Response:

- `account`: current profile, including `permissions`
- `accessibleDomains`: list of domains the user can currently access

### `PATCH /v1/auth/me`

Body:

```json
{
  "displayName": "New Name",
  "telegramId": "123456789"
}
```

### `POST /v1/auth/me/password`

Body:

```json
{
  "currentPassword": "old-pass",
  "newPassword": "new-pass-123"
}
```

### `POST /v1/auth/me/api-key/rotate`

Not required for the web frontend, but currently used on the profile tab to generate a new API key.

## Users

Admin only.

### `GET /v1/users`

Supported query params:

- `q`: search by `username`, `displayName`, `telegramId`
- `telegramId`: exact filter by Telegram ID
- `limit` defaults to `50`, max `200`
- `offset` defaults to `0`

Returns:

- `total`
- `count`
- `users[]`
- each user has a `permissionCount`

### `POST /v1/users`

Body:

```json
{
  "username": "alice",
  "password": "alice-pass-123",
  "displayName": "Alice",
  "telegramId": "123456789"
}
```

New users are always created with `active` status.

May also include:

- `generateApiKey`
- `apiKey`

### `GET /v1/users/:userId`

Returns the full `user`, including `permissions[]`.

### `PATCH /v1/users/:userId`

Allowed changes:

- `username`
- `password`
- `displayName`
- `telegramId`
- `status`

Guard:

- the last `active admin` cannot be disabled

### `POST /v1/users/:userId/api-key/rotate`

Admin rotates the API key for any user.

## Admins

Admin only.

### `GET /v1/admins`

Supported query params:

- `q`: search by `username`, `displayName`, `telegramId`
- `limit` defaults to `50`, max `200`
- `offset` defaults to `0`

Returns:

- `total`
- `count`
- `admins[]`

### `POST /v1/admins`

Body:

```json
{
  "userId": 12
}
```

or

```json
{
  "username": "alice"
}
```

### `DELETE /v1/admins/:userId`

Revokes admin rights. The last `active admin` cannot be revoked.

## Permissions

Admin only. Permissions are now domain-only.

Schema:

```json
{
  "id": 1,
  "domain": "example.com",
  "status": "active",
  "user": {
    "id": 12,
    "username": "alice",
    "displayName": "Alice",
    "telegramId": "123456789",
    "status": "active"
  },
  "grantedBy": {
    "userId": 1,
    "username": "admin",
    "displayName": "Admin"
  },
  "createdAt": "2026-03-21T10:00:00.000Z",
  "updatedAt": "2026-03-21T10:00:00.000Z"
}
```

### `GET /v1/permissions`

Supported query params:

- `userId`
- `username`
- `domain`
- `status`
- `limit` defaults to `50`, max `200`
- `offset` defaults to `0`

Response:

- `total`
- `count`
- `permissions[]`

### `POST /v1/permissions`

Body:

```json
{
  "userId": 12,
  "domain": "example.com"
}
```

New permissions are always created with `active` status.

Or target by `username`. If the `username` does not exist yet, the backend may auto-create a user shell.
This route is create-only. If the permission already exists, it returns `409`.

### `GET /v1/permissions/:permissionId`

Fetch details of a single permission.

### `DELETE /v1/permissions/:permissionId`

Delete a permission.
If the target user is not a global admin, the backend also cleans up:

- that user's `email_registers` on the domain
- that user's pending/failed `telegram_outbox` entries for the domain

## Domains

### `GET /v1/domains`

- Admin: sees all domains
- Regular user: only sees domains they have permission on
- Query supports `limit` default `50`, max `200`
- Query supports `offset` default `0`

Each domain has:

```json
{
  "counts": {
    "permissionCount": 3,
    "emails": 120
  }
}
```

Response:

- `total`
- `count`
- `domains[]`

### `POST /v1/domains`

Admin only.

Body:

```json
{
  "domain": "example.com",
  "description": "Primary domain",
  "isDefault": false
}
```

New domains are always `active` with inbound mail enabled (`inboundEnabled = true`).

This route is create-only. If the domain already exists, it returns `409`.

### `GET /v1/domains/:domain`

The user must have permission on that domain or be an admin.

### `DELETE /v1/domains/:domain`

Admin only.
Deletes the domain and cascades cleanup of all `permissions`, `emails`, and `email_registers` belonging to that domain.

## Email Registers

Mailbox registrations for realtime monitoring.

### `GET /v1/email-registers`

- Regular user: gets their own mailboxes
- Admin: may pass the `ownerUserId` query
- Query supports `limit` default `50`, max `200`
- Query supports `offset` default `0`
- Query supports `search` (optional, max 200 characters): filters `recipient_address` containing the string (case-insensitive), affects both `total` and `registrations`

Response:

- `total`
- `count`
- `registrations[]`

### `GET /v1/email-registers/new-mail`

Creates a random mailbox and immediately registers it for the current owner.

Auth:

- works with a session token
- works with an API key (`X-Api-Key` or `Authorization: ApiKey ...`)

Optional query:

- `domain`: force the mailbox to be created on a specific domain — subdomains of a registered domain are accepted too (e.g. `domain=abc.example.com` generates `...@abc.example.com`, checked against the parent's permissions)
- `ownerUserId`: admins can create for another user

Rules:

- the backend only picks `active` domains
- regular users can only generate on domains where the caller has an `active` `permission`
- admins can generate across all `active` domains
- if `domain` is not passed, the backend prefers the default domain or the first domain in the caller's usable domain set
- the generated mailbox follows a real-address-like pattern and is retried until an address is found that has never appeared in `email_registers` or `emails`

### `POST /v1/email-registers`

Body:

```json
{
  "emailAddress": "alice@example.com"
}
```

A mailbox can only be registered if its domain already exists in the `domains` table.

Admins may also pass:

```json
{
  "emailAddress": "alice@example.com",
  "ownerUserId": 12
}
```

Rules:

- the caller must have permission on the mailbox's domain
- if the mailbox is already registered by another user, returns `409`
- re-registering with the same owner is idempotent

### `DELETE /v1/email-registers/:registrationId`

Deletes a mailbox registration. Pending/failed `telegram_outbox` entries for that mailbox are also cleaned up.

## Emails

### `GET /v1/emails`

Query:

- `limit` defaults to `50`, max `200`
- `cursor`: opaque cursor to fetch the next page
- `domain`
- `address`
- `search`: multiple space-separated terms allowed; each term must match at least one field among `subject`, `text/html body`, stored metadata/headers (`from`, `to`, `messageId`, `envelopeFrom`, `workerName`, `sourceDomain`), or `raw MIME` if the mail still retains the original MIME
- `scope=registered|system`

Rules:

- Regular users can only use `scope=registered` and only see mail of mailboxes registered by themselves
- Admins can use `scope=system` to read all system mail
- If `scope` is not passed, the backend keeps the default behavior for the current auth

Response:

- `count`
- `emails[]`
- `hasMore`
- `nextCursor`

Every route that returns an email list (`GET /v1/emails`, `GET /v1/inboxes/:emailAddress`) returns the trimmed `EmailSummary`, **without the full `text` and `html`**:

- `preview`: first 400 characters of the text body, enough to render a list row
- `hasText` / `hasHtml`: indicates which content formats the mail has without downloading the content

Rationale: embedding full bodies in every row bloats the payload with the email count (50 emails ≈ 440KB), causing UI jank on large mailboxes. Call the detail route when full content is needed.

### `GET /v1/emails/:id`

Returns the full `Email`, including `text` and `html`.

Query:

- `includeRawMime=1`

### `DELETE /v1/emails/:id`

Regular users can only delete mail belonging to a registered mailbox where they have permission on the domain.

### `POST /v1/emails/bulk-delete`

Body:

```json
{
  "emailIds": [1, 2, 3]
}
```

Behavior:

- at most `200` email IDs per request
- the backend checks `write` permission on each email before deleting
- the response includes `deletedIds`, `missingIds`, `deniedIds` so the frontend can handle stale batch selections

## Blocked Senders

Admin only. Mail from blocked senders is dropped right at the ingest step: not stored in the DB, no Telegram notification.

### `GET /v1/blocked-senders`

Query:

- `q`: search by `pattern` or `reason`
- `patternType=email|domain`
- `status=active|disabled`
- `scope=global|domain`
- `domain`: filter by the recipient domain the rule is limited to
- `limit` defaults to `50`, max `200`
- `offset` defaults to `0`

Response:

- `total`
- `count`
- `blockedSenders[]`

### `POST /v1/blocked-senders`

Body:

```json
{
  "pattern": "spam@example.com",
  "patternType": "email",
  "domain": null,
  "reason": "Advertising spam",
  "status": "active"
}
```

Behavior:

- if `patternType` is empty, the backend infers it: contains `@` → `email`, otherwise → `domain`
- a `pattern` like `@example.com` is also treated as blocking the whole domain
- `patternType=domain` blocks all subdomains too, e.g. `example.com` also blocks `mail.example.com`
- an empty or `null` `domain` makes the rule apply system-wide; otherwise it only applies to mail sent to that recipient domain
- a duplicate `patternType + pattern + domain` returns `409`

### `GET /v1/blocked-senders/:blockedSenderId`
### `PATCH /v1/blocked-senders/:blockedSenderId`

The body accepts the same fields as creation, all optional. Use `status=disabled` to temporarily turn off a rule without deleting it.

### `DELETE /v1/blocked-senders/:blockedSenderId`

Permanently deletes the rule. Mail already blocked earlier is not restored.

## Inboxes

### `GET /v1/inboxes/:emailAddress`

The path must be URL-encoded, e.g. `alice%40example.com`.

Query:

- `limit`, default `50`, max `200`
- `cursor`: opaque cursor to fetch the next page
- `stime`: numeric Unix timestamp, only returns mail with `receivedAt` greater than this value

Rules:

- the mailbox must belong to the caller's `email_registers`, unless the caller is an admin
- the caller must have permission on the mailbox's domain

Response:

- `count`
- `emails[]`
- `hasMore`
- `nextCursor`

### `DELETE /v1/inboxes/:emailAddress`

Deletes all mail of the mailbox.

## Inbound

### `POST /v1/inbound/email`

Worker-only route.

- Auth via inbound token
- Body is raw MIME
- Main headers:
  - `X-Email-Envelope-To`
  - `X-Email-Envelope-From`
  - `X-Email-Worker-Name`

If the sender matches a rule in `blocked_senders`, the mail is dropped: the response is still `202` with `blocked: true`, `id: null`, and `blockedBy` describing the matched rule. Returning `202` lets the worker treat it as fully processed, without retrying and without bouncing back to the sender.

Wildcard subdomains: a registered domain receives mail for **all of its subdomains** — `user@abc.example.com` and `user@foo.bar.example.com` are filed under the registered `example.com` row (longest matching ancestor wins). The exact recipient is preserved (`to`/`domain` on the stored email show the subdomain), and the parent domain's permissions and blocked-sender rules apply. Mail for subdomains of an unregistered domain is rejected (`422`), or `409` when the matching ancestor is disabled/inbound-off.

The frontend does not use this route.

## Maintenance

### `GET /v1/maintenance/storage`

Admin only.

Returns the current size of:

- the main SQLite file
- the `-wal` file
- the `-shm` file
- the total size of the directory containing SQLite

### `POST /v1/maintenance/prune-raw-mime`

Admin only.

Used on the overview tab to clean up raw MIME past its retention period.

### `POST /v1/maintenance/prune-emails`

Admin only.

Deletes old mail system-wide in batches to clean up a large SQLite.

Body:

```json
{
  "olderThanDays": 30,
  "domain": "example.com",
  "dryRun": true,
  "limit": 5000
}
```

Rules:

- `olderThanDays` is required
- `domain` is optional, to prune only one domain
- `dryRun=true` only reports statistics, nothing is deleted
- `limit` caps the number of emails deleted in one run
- if `dryRun=false`, the backend automatically `VACUUM`s SQLite right after deletion finishes

## System

### `GET /v1/system/telegram`

Super admin only.

Returns:

- `settings`: public Telegram settings, without exposing the raw bot token
- `runtime`: current runtime state, including webhook, outbox, and the most recent error

### `PATCH /v1/system/telegram`

Super admin only.

Supported body:

```json
{
  "enabled": true,
  "publicBaseUrl": "https://example.com",
  "botToken": "123456:bot-token",
  "clearBotToken": false
}
```

Behavior:

- saves the bot config to `system_settings`
- auto-generates a webhook secret if none exists
- reloads the Telegram runtime immediately after saving
- if reload fails, the backend rolls back to the previous Telegram config and attempts to restart the old runtime
- if the runtime reload fails, returns `502` along with the current `settings` and `runtime`

### `POST /v1/system/telegram/commands/register`

Super admin only.

Re-registers the bot's command list with the Telegram API.

Returns:

- `count`
- `commands[]`
- `runtime`

## Telegram

### `POST /v1/telegram/webhook`

Webhook route for the Telegram Bot.

- Does not use JWT sessions
- Must send the `X-Telegram-Bot-Api-Secret-Token` header
- The secret must match the `webhookSecret` stored in system settings
- Body is a Telegram update JSON

Main response fields:

- `success`
- `handled`
