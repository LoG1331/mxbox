# Email Forwarder (Cloudflare Email Worker)

This guide explains how to set up the edge forwarder that receives email for your
domains and relays it into the mxbox server.

The forwarder is a **Cloudflare Email Worker**. It does no business logic at the
edge: it takes each incoming message and POSTs the raw MIME body, plus envelope
metadata as headers, to the mxbox backend. All storage, parsing, and access
control happen server-side.

## Architecture

```
Sender ──► Cloudflare Email Routing ──► Email Worker (forwarder)
                                              │  POST raw MIME
                                              │  Authorization: Bearer <token>
                                              ▼
                                   mxbox server
                                   POST /v1/inbound/email
                                   (INBOUND_AUTH_TOKEN, Express + SQLite)
```

- Cloudflare Email Routing delivers messages for your domain to the Worker.
- The Worker reads the raw message (`message.raw`) and forwards it to
  `FORWARD_TARGET_URL` — the server's `POST /v1/inbound/email` endpoint.
- The request is authenticated with `Authorization: Bearer <FORWARD_AUTH_TOKEN>`,
  which must match the server's `INBOUND_AUTH_TOKEN`.
- Envelope metadata travels in headers:
  - `X-Email-Envelope-From`, `X-Email-Envelope-To` — SMTP envelope addresses
  - `X-Email-Worker-Name` — value of `WORKER_NAME`
  - `X-Email-Domain` — value of `EMAIL_DOMAIN` (optional)
  - `X-Email-Received-At`, `X-Email-Processing-Mode`, `X-Email-Size`
- The Worker also exposes `GET /health` for liveness checks. Any other HTTP path
  returns a plain "ingress only" response.

## Worker source code

The forwarder was previously developed in the `workers/` directory, which has
since been removed. The complete source is kept here — copy it verbatim into
your own Worker project (e.g. `src/index.js`):

```js
const MAX_ERROR_BODY_LENGTH = 500;

function sanitizeHeader(value) {
    return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

async function forwardToServer(message, env) {
    if (!env.FORWARD_TARGET_URL) {
        throw new Error('FORWARD_TARGET_URL is required');
    }

    const rawEmail = await new Response(message.raw).arrayBuffer();
    const headers = new Headers({
        'Content-Type': 'message/rfc822',
        'X-Email-Envelope-From': sanitizeHeader(message.from),
        'X-Email-Envelope-To': sanitizeHeader(message.to),
        'X-Email-Worker-Name': sanitizeHeader(env.WORKER_NAME || 'new-worker'),
        'X-Email-Received-At': new Date().toISOString(),
        'X-Email-Processing-Mode': 'forward',
        'X-Email-Size': String(rawEmail.byteLength)
    });

    if (env.EMAIL_DOMAIN) {
        headers.set('X-Email-Domain', sanitizeHeader(env.EMAIL_DOMAIN));
    }

    if (env.FORWARD_AUTH_TOKEN) {
        headers.set('Authorization', `Bearer ${env.FORWARD_AUTH_TOKEN}`);
    }

    const response = await fetch(env.FORWARD_TARGET_URL, {
        method: 'POST',
        headers,
        body: rawEmail
    });

    if (!response.ok) {
        const errorBody = (await response.text().catch(() => '')).slice(0, MAX_ERROR_BODY_LENGTH);
        throw new Error(`Forward target responded with ${response.status}${errorBody ? `: ${errorBody}` : ''}`);
    }

    console.log(`Forwarded ${message.to} to ${env.FORWARD_TARGET_URL}`);
}

export default {
    async email(message, env) {
        await forwardToServer(message, env);
    },

    async fetch(request, env) {
        const url = new URL(request.url);

        if (url.pathname === '/health') {
            return Response.json({
                ok: true,
                mode: 'forward-only',
                targetConfigured: Boolean(env.FORWARD_TARGET_URL)
            });
        }

        return new Response('workers ingress only', {
            headers: {
                'Content-Type': 'text/plain; charset=utf-8'
            }
        });
    }
};
```

Note: the Worker is intentionally dependency-free — no bundling step is needed.

## Environment variables and secrets

| Name | Type | Required | Description |
| --- | --- | --- | --- |
| `FORWARD_TARGET_URL` | var | yes | Full URL of the server's inbound endpoint, e.g. `https://mx.example.com/v1/inbound/email` |
| `FORWARD_AUTH_TOKEN` | secret | recommended | Bearer token; must equal the server's `INBOUND_AUTH_TOKEN` |
| `WORKER_NAME` | var | no | Identifier sent in `X-Email-Worker-Name` (default: `new-worker`) |
| `EMAIL_DOMAIN` | var | no | Domain label sent in `X-Email-Domain` |

For local development with `wrangler dev`, create a `.dev.vars` file next to
your `wrangler.toml` (this mirrors the old `.dev.vars.example`):

```
FORWARD_TARGET_URL=http://127.0.0.1:3001/v1/inbound/email
FORWARD_AUTH_TOKEN=replace-me
WORKER_NAME=new-worker-local
EMAIL_DOMAIN=example.com
```

## Deployment

Prerequisites: Node.js >= 22, a Cloudflare account, and your domain's DNS
managed by Cloudflare (required for Email Routing).

1. Create the Worker project:

   ```bash
   mkdir mxbox-forwarder && cd mxbox-forwarder
   mkdir src
   # paste the source above into src/index.js
   ```

2. Create `wrangler.toml`:

   ```toml
   name = "mxbox-forwarder"
   main = "src/index.js"
   compatibility_date = "2025-01-01"

   [vars]
   FORWARD_TARGET_URL = "https://mx.example.com/v1/inbound/email"
   WORKER_NAME = "edge-sg-1"
   EMAIL_DOMAIN = "example.com"
   ```

3. Install Wrangler and log in:

   ```bash
   npm install --save-dev wrangler
   npx wrangler login
   ```

4. Set the auth token as a secret (never put it in `wrangler.toml`):

   ```bash
   npx wrangler secret put FORWARD_AUTH_TOKEN
   ```

   This value must be identical to `INBOUND_AUTH_TOKEN` on the mxbox server.

5. Deploy:

   ```bash
   npx wrangler deploy
   ```

6. Wire up email routing. In the Cloudflare dashboard:
   **Email → Email Routing → Routing rules → Create address / Catch-all**,
   action **Send to a Worker**, select `mxbox-forwarder`. Repeat per domain, or
   enable a catch-all rule. Cloudflare will add the required MX/SPF records if
   prompted.

## Verification

1. Health check:

   ```bash
   curl https://mxbox-forwarder.<your-subdomain>.workers.dev/health
   ```

   Expect `{"ok":true,"mode":"forward-only","targetConfigured":true}`.

2. Server-side check — simulate what the Worker sends:

   ```bash
   curl -i -X POST https://mx.example.com/v1/inbound/email \
     -H "Authorization: Bearer $INBOUND_AUTH_TOKEN" \
     -H "Content-Type: message/rfc822" \
     -H "X-Email-Envelope-To: test@example.com" \
     -H "X-Email-Envelope-From: sender@other.example" \
     --data-binary $'From: sender@other.example\r\nTo: test@example.com\r\nSubject: forwarder test\r\n\r\nhello\r\n'
   ```

   A `2xx` response means the server accepted the message. A `401` means the
   tokens don't match; a `404` means `FORWARD_TARGET_URL` is wrong.

3. End-to-end: send a real email to an address on the routed domain, then
   confirm it appears in the mxbox UI for the corresponding mailbox. If it does
   not arrive, check live logs with `npx wrangler tail` and the server logs —
   the Worker throws (and Cloudflare retries) when the forward target responds
   with a non-2xx status.
