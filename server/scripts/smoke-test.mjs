import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import { createServer as createHttpServer } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { once } from 'node:events';
import { createApp } from '../src/app.mjs';
import { loadConfig } from '../src/config.mjs';
import { closeDb, getDb, maybePruneStoredRawMime } from '../src/db/index.mjs';
import { ensureBootstrapAdmin, revokeExpiredSessions } from '../src/services/account-service.mjs';
import { ensureAuthSecrets } from '../src/services/auth-secrets-service.mjs';
import { getTelegramSettings } from '../src/services/telegram-settings-service.mjs';
import { startTelegramRuntime, stopTelegramRuntime } from '../src/telegram/runtime.mjs';

function createMimeMessage({ to, subject, messageId, text }) {
    return [
        'From: Sender <sender@example.net>',
        `To: ${to}`,
        `Subject: ${subject}`,
        `Message-ID: <${messageId}>`,
        'Content-Type: text/plain; charset=utf-8',
        '',
        text
    ].join('\r\n');
}

function base64UrlEncode(value) {
    const buffer = Buffer.isBuffer(value)
        ? value
        : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
    return buffer.toString('base64url');
}

function signJwtForTest(secret, payload, expiresAtMs) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const fullPayload = {
        ...payload,
        iat: Math.floor(Date.now() / 1000),
        exp: Math.floor(expiresAtMs / 1000)
    };
    const signingInput = `${base64UrlEncode(header)}.${base64UrlEncode(fullPayload)}`;
    const signature = createHmac('sha256', secret)
        .update(signingInput)
        .digest('base64url');
    return `${signingInput}.${signature}`;
}

async function request(baseUrl, pathname, {
    method = 'GET',
    json,
    body,
    token,
    apiKey,
    headers = {}
} = {}) {
    const requestHeaders = new Headers(headers);

    if (token) {
        requestHeaders.set('Authorization', `Bearer ${token}`);
    }

    if (apiKey) {
        requestHeaders.set('X-Api-Key', apiKey);
    }

    let requestBody = body;
    if (json !== undefined) {
        requestHeaders.set('Content-Type', 'application/json');
        requestBody = JSON.stringify(json);
    }

    const response = await fetch(`${baseUrl}${pathname}`, {
        method,
        headers: requestHeaders,
        body: requestBody
    });

    const text = await response.text();
    let payload = null;
    if (text) {
        try {
            payload = JSON.parse(text);
        } catch {
            payload = text;
        }
    }

    return {
        status: response.status,
        body: payload
    };
}

function assertStatus(response, expectedStatus, label) {
    assert.equal(
        response.status,
        expectedStatus,
        `${label} failed with ${response.status}: ${JSON.stringify(response.body)}`
    );
}

async function startServer(config) {
    await getDb(config);
    await ensureAuthSecrets(config);
    await maybePruneStoredRawMime(config, { force: true });
    await revokeExpiredSessions(config);
    await ensureBootstrapAdmin(config);
    await startTelegramRuntime(config);

    const app = createApp(config);
    const server = app.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Failed to resolve smoke test server address');
    }

    return {
        server,
        baseUrl: `http://127.0.0.1:${address.port}`
    };
}

async function stopServer(server) {
    if (!server) {
        return;
    }

    await new Promise((resolve, reject) => {
        server.close(error => {
            if (error) {
                reject(error);
                return;
            }

            resolve();
        });
    });
}

async function startFakeTelegramApi() {
    const calls = [];
    let nextMessageId = 1000;
    const state = {
        failSendMessageCount: 0,
        failMethodCounts: {}
    };

    const server = createHttpServer(async (req, res) => {
        const chunks = [];
        for await (const chunk of req) {
            chunks.push(chunk);
        }

        const bodyText = Buffer.concat(chunks).toString('utf8');
        let body = null;
        if (bodyText) {
            body = JSON.parse(bodyText);
        }

        const match = req.url?.match(/^\/bot[^/]+\/([^/?]+)/);
        const method = match?.[1] || 'unknown';
        calls.push({
            method,
            body
        });

        if ((state.failMethodCounts[method] || 0) > 0) {
            state.failMethodCounts[method] -= 1;
            res.writeHead(500, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({
                ok: false,
                description: `forced ${method} failure`
            }));
            return;
        }

        if (method === 'sendMessage' && state.failSendMessageCount > 0) {
            state.failSendMessageCount -= 1;
            res.writeHead(500, {
                'Content-Type': 'application/json'
            });
            res.end(JSON.stringify({
                ok: false,
                description: 'forced sendMessage failure'
            }));
            return;
        }

        let result = true;
        if (method === 'sendMessage' || method === 'editMessageText') {
            result = {
                message_id: nextMessageId++,
                text: body?.text || ''
            };
        }

        res.writeHead(200, {
            'Content-Type': 'application/json'
        });
        res.end(JSON.stringify({
            ok: true,
            result
        }));
    });

    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address();
    if (!address || typeof address === 'string') {
        throw new Error('Failed to resolve fake Telegram API address');
    }

    return {
        server,
        calls,
        state,
        baseUrl: `http://127.0.0.1:${address.port}`
    };
}

async function waitFor(predicate, timeoutMs = 2000) {
    const startedAt = Date.now();
    while (Date.now() - startedAt < timeoutMs) {
        if (predicate()) {
            return;
        }

        await new Promise(resolve => setTimeout(resolve, 25));
    }

    throw new Error('Timed out waiting for async condition');
}

async function main() {
    const tempRoot = await mkdtemp(path.join(tmpdir(), 'email-worker-server-'));
    let server;
    let fakeTelegram;

    try {
        fakeTelegram = await startFakeTelegramApi();
        const config = loadConfig({
            NODE_ENV: 'test',
            HOST: '127.0.0.1',
            INBOUND_AUTH_TOKEN: 'smoke-inbound-token',
            NEW_SERVER_SQLITE_PATH: path.join(tempRoot, 'smoke.sqlite'),
            STORE_RAW_MIME: '0',
            BOOTSTRAP_ADMIN_USERNAME: 'admin',
            BOOTSTRAP_ADMIN_PASSWORD: 'admin-pass-123'
        });
        config.telegramApiBaseUrl = fakeTelegram.baseUrl;
        config.telegramOutboxPollIntervalMs = 50;
        config.telegramOutboxBaseBackoffMs = 50;

        const started = await startServer(config);
        server = started.server;
        const { baseUrl } = started;

        const health = await request(baseUrl, '/health');
        assertStatus(health, 200, 'health');
        assert.equal(health.body.ok, true);
        assert.equal(health.body.service, 'server');
        assert.ok(typeof health.body.systemTime === 'string');
        assert.ok(Number.isInteger(health.body.systemTimeMs));
        assert.equal(health.body.storage.engine, 'sqlite');
        assert.equal(health.body.storage.ready, true);
        assert.equal('sqlitePath' in health.body, false);
        assert.equal(health.body.telegram.enabled, false);
        assert.equal(fakeTelegram.calls.length, 0);

        const adminPassword = 'admin-pass-123';
        let adminToken = '';
        const adminLogin = await request(baseUrl, '/v1/auth/login', {
            method: 'POST',
            json: {
                username: 'admin',
                password: adminPassword
            }
        });
        assertStatus(adminLogin, 200, 'admin login');
        adminToken = adminLogin.body.sessionToken;
        assert.ok(adminToken);
        assert.equal(adminLogin.body.account.isAdmin, true);
        const adminUserId = adminLogin.body.account.id;

        const forgedAdminSession = await request(baseUrl, '/v1/auth/me', {
            token: signJwtForTest(config.inboundAuthToken, {
                token_type: 'session',
                sub: String(adminLogin.body.account.id),
                sid: String(adminLogin.body.session.id)
            }, Date.now() + 60 * 60 * 1000)
        });
        assertStatus(forgedAdminSession, 401, 'inbound token cannot forge session jwt');

        const adminProfileUpdate = await request(baseUrl, '/v1/auth/me', {
            method: 'PATCH',
            token: adminToken,
            json: {
                displayName: 'Admin Smoke',
                telegramId: '555555555'
            }
        });
        assertStatus(adminProfileUpdate, 200, 'admin updates own profile');
        assert.equal(adminProfileUpdate.body.account.telegramId, '555555555');

        const adminPasswordChange = await request(baseUrl, '/v1/auth/me/password', {
            method: 'POST',
            token: adminToken,
            json: {
                currentPassword: adminPassword,
                newPassword: 'admin-pass-456'
            }
        });
        assertStatus(adminPasswordChange, 200, 'admin changes own password');

        await ensureBootstrapAdmin(config);

        const adminOldPasswordLogin = await request(baseUrl, '/v1/auth/login', {
            method: 'POST',
            json: {
                username: 'admin',
                password: adminPassword
            }
        });
        assertStatus(adminOldPasswordLogin, 401, 'bootstrap rerun does not reset existing admin password');

        const adminLoginAfterBootstrapRerun = await request(baseUrl, '/v1/auth/login', {
            method: 'POST',
            json: {
                username: 'admin',
                password: 'admin-pass-456'
            }
        });
        assertStatus(adminLoginAfterBootstrapRerun, 200, 'admin login after bootstrap rerun');
        adminToken = adminLoginAfterBootstrapRerun.body.sessionToken;
        assert.equal(adminLoginAfterBootstrapRerun.body.account.telegramId, '555555555');

        const configureTelegram = await request(baseUrl, '/v1/system/telegram', {
            method: 'PATCH',
            token: adminToken,
            json: {
                enabled: true,
                publicBaseUrl: 'https://example.test',
                botToken: 'smoke-telegram-token'
            }
        });
        assertStatus(configureTelegram, 200, 'configure telegram via admin api');
        assert.equal(configureTelegram.body.settings.enabled, true);
        assert.equal(configureTelegram.body.settings.publicBaseUrl, 'https://example.test');
        assert.equal(configureTelegram.body.settings.botTokenConfigured, true);
        assert.match(String(configureTelegram.body.settings.botTokenMasked || ''), /smoke-/);
        assert.equal(fakeTelegram.calls[0]?.method, 'setWebhook');
        assert.equal(fakeTelegram.calls[0]?.body?.url, 'https://example.test/v1/telegram/webhook');

        const telegramSettings = await getTelegramSettings(config);
        assert.ok(telegramSettings.webhookSecret);
        assert.ok(!('botToken' in configureTelegram.body.runtime.settings) || configureTelegram.body.runtime.settings.botTokenConfigured === true);

        fakeTelegram.state.failMethodCounts.setWebhook = 1;
        const brokenTelegramReload = await request(baseUrl, '/v1/system/telegram', {
            method: 'PATCH',
            token: adminToken,
            json: {
                publicBaseUrl: 'https://broken.example.test'
            }
        });
        assertStatus(brokenTelegramReload, 502, 'telegram runtime reload rollback');
        assert.equal(brokenTelegramReload.body.rolledBack, true);
        assert.equal(brokenTelegramReload.body.rollbackError, null);
        assert.equal(brokenTelegramReload.body.settings.publicBaseUrl, 'https://example.test');
        assert.equal(brokenTelegramReload.body.runtime.enabled, true);
        assert.equal(brokenTelegramReload.body.runtime.workerActive, true);
        assert.equal(brokenTelegramReload.body.runtime.webhookUrl, 'https://example.test/v1/telegram/webhook');
        assert.equal(fakeTelegram.calls[1]?.method, 'setWebhook');
        assert.equal(fakeTelegram.calls[1]?.body?.url, 'https://broken.example.test/v1/telegram/webhook');
        assert.equal(fakeTelegram.calls[2]?.method, 'setWebhook');
        assert.equal(fakeTelegram.calls[2]?.body?.url, 'https://example.test/v1/telegram/webhook');

        const registerCommands = await request(baseUrl, '/v1/system/telegram/commands/register', {
            method: 'POST',
            token: adminToken
        });
        assertStatus(registerCommands, 200, 'register telegram commands');
        assert.equal(registerCommands.body.count, 11);
        assert.equal(fakeTelegram.calls[3]?.method, 'setMyCommands');
        assert.equal(Array.isArray(fakeTelegram.calls[3]?.body?.commands), true);
        assert.equal(fakeTelegram.calls[3]?.body?.commands[0]?.command, 'start');

        const createDomain = await request(baseUrl, '/v1/domains', {
            method: 'POST',
            token: adminToken,
            json: {
                domain: 'example.com',
                description: 'Smoke test domain'
            }
        });
        assertStatus(createDomain, 201, 'create domain');
        assert.equal(createDomain.body.domain.domain, 'example.com');

        const createDuplicateDomain = await request(baseUrl, '/v1/domains', {
            method: 'POST',
            token: adminToken,
            json: {
                domain: 'example.com',
                description: 'Duplicate domain'
            }
        });
        assertStatus(createDuplicateDomain, 409, 'duplicate domain create rejected');

        const patchDomainRemoved = await request(baseUrl, '/v1/domains/example.com', {
            method: 'PATCH',
            token: adminToken,
            json: {
                description: 'No longer supported'
            }
        });
        assertStatus(patchDomainRemoved, 404, 'domain patch removed');

        const createInvalidDomain = await request(baseUrl, '/v1/domains', {
            method: 'POST',
            token: adminToken,
            json: {
                domain: '-invalid..domain-',
                description: 'Should fail'
            }
        });
        assertStatus(createInvalidDomain, 400, 'create invalid domain');

        const createCleanupDomain = await request(baseUrl, '/v1/domains', {
            method: 'POST',
            token: adminToken,
            json: {
                domain: 'cleanup.test',
                description: 'Cascade cleanup domain'
            }
        });
        assertStatus(createCleanupDomain, 201, 'create cleanup domain');

        const registerMissingDomainMailbox = await request(baseUrl, '/v1/email-registers', {
            method: 'POST',
            token: adminToken,
            json: {
                emailAddress: 'ghost@missing.test'
            }
        });
        assertStatus(registerMissingDomainMailbox, 404, 'register mailbox requires existing domain');

        const createDisabledDomain = await request(baseUrl, '/v1/domains', {
            method: 'POST',
            token: adminToken,
            json: {
                domain: 'disabled.test',
                description: 'Disabled domain'
            }
        });
        assertStatus(createDisabledDomain, 201, 'create domain to disable');
        assert.equal(createDisabledDomain.body.domain.status, 'active');

        // The create API always creates domains as active; seed the disabled
        // state directly via the DB so we can still test the register-blocking
        // flow on a disabled domain.
        const smokeDb = await getDb(config);
        await smokeDb.run(`UPDATE domains SET status = 'disabled' WHERE name = ?`, ['disabled.test']);

        const registerDisabledDomainMailbox = await request(baseUrl, '/v1/email-registers', {
            method: 'POST',
            token: adminToken,
            json: {
                emailAddress: 'norecv@disabled.test'
            }
        });
        assertStatus(registerDisabledDomainMailbox, 409, 'register mailbox blocked on disabled domain');

        const createInboundOffDomain = await request(baseUrl, '/v1/domains', {
            method: 'POST',
            token: adminToken,
            json: {
                domain: 'inboundoff.test',
                description: 'Inbound off domain'
            }
        });
        assertStatus(createInboundOffDomain, 201, 'create domain to turn inbound off');
        assert.equal(createInboundOffDomain.body.domain.inboundEnabled, true);

        await smokeDb.run(`UPDATE domains SET inbound_enabled = 0 WHERE name = ?`, ['inboundoff.test']);

        const registerInboundOffMailbox = await request(baseUrl, '/v1/email-registers', {
            method: 'POST',
            token: adminToken,
            json: {
                emailAddress: 'norecv@inboundoff.test'
            }
        });
        assertStatus(registerInboundOffMailbox, 409, 'register mailbox blocked when inbound disabled');

        const registerAdminMailbox = await request(baseUrl, '/v1/email-registers/new-mail?domain=example.com', {
            token: adminToken
        });
        assertStatus(registerAdminMailbox, 200, 'register random admin mailbox');
        assert.match(registerAdminMailbox.body.registration.emailAddress, /^[a-z0-9]+(?:[._]?[a-z0-9]+)*@example\.com$/);
        assert.equal(registerAdminMailbox.body.registration.domain, 'example.com');

        const createUser = await request(baseUrl, '/v1/users', {
            method: 'POST',
            token: adminToken,
            json: {
                username: 'alice',
                password: 'alice-pass-123',
                displayName: 'Alice Smoke',
                telegramId: '123456789'
            }
        });
        assertStatus(createUser, 201, 'create user');
        const aliceUserId = createUser.body.user.id;
        assert.ok(aliceUserId);

        const createBob = await request(baseUrl, '/v1/users', {
            method: 'POST',
            token: adminToken,
            json: {
                username: 'bob',
                password: 'bob-pass-123',
                displayName: 'Bob Smoke'
            }
        });
        assertStatus(createBob, 201, 'create bob');
        const bobUserId = createBob.body.user.id;
        assert.ok(bobUserId);

        const disableLastActiveAdmin = await request(baseUrl, `/v1/users/${adminUserId}`, {
            method: 'PATCH',
            token: adminToken,
            json: {
                status: 'disabled'
            }
        });
        assertStatus(disableLastActiveAdmin, 409, 'cannot disable last active admin');

        const grantBobAdmin = await request(baseUrl, '/v1/admins', {
            method: 'POST',
            token: adminToken,
            json: {
                userId: bobUserId
            }
        });
        assertStatus(grantBobAdmin, 201, 'grant bob admin');

        const disableBobAdmin = await request(baseUrl, `/v1/users/${bobUserId}`, {
            method: 'PATCH',
            token: adminToken,
            json: {
                status: 'disabled'
            }
        });
        assertStatus(disableBobAdmin, 200, 'disable bob admin');

        const revokeLastActiveAdmin = await request(baseUrl, `/v1/admins/${adminUserId}`, {
            method: 'DELETE',
            token: adminToken
        });
        assertStatus(revokeLastActiveAdmin, 409, 'cannot revoke last active admin');

        const reenableBob = await request(baseUrl, `/v1/users/${bobUserId}`, {
            method: 'PATCH',
            token: adminToken,
            json: {
                status: 'active'
            }
        });
        assertStatus(reenableBob, 200, 'reenable bob after admin guard checks');

        const revokeBobAdmin = await request(baseUrl, `/v1/admins/${bobUserId}`, {
            method: 'DELETE',
            token: adminToken
        });
        assertStatus(revokeBobAdmin, 200, 'revoke bob admin after guard checks');

        const createPermission = await request(baseUrl, '/v1/permissions', {
            method: 'POST',
            token: adminToken,
            json: {
                userId: aliceUserId,
                domain: 'example.com'
            }
        });
        assertStatus(createPermission, 201, 'create permission');
        const permissionId = createPermission.body.permission.id;
        assert.ok(permissionId);

        const createCleanupPermission = await request(baseUrl, '/v1/permissions', {
            method: 'POST',
            token: adminToken,
            json: {
                userId: aliceUserId,
                domain: 'cleanup.test'
            }
        });
        assertStatus(createCleanupPermission, 201, 'create cleanup permission');

        const patchPermissionRemoved = await request(baseUrl, `/v1/permissions/${permissionId}`, {
            method: 'PATCH',
            token: adminToken,
            json: {
                status: 'disabled'
            }
        });
        assertStatus(patchPermissionRemoved, 404, 'permission patch removed');

        const telegramUnauthorized = await request(baseUrl, '/v1/telegram/webhook', {
            method: 'POST',
            json: {
                update_id: 1,
                message: {
                    message_id: 1,
                    chat: { id: 123456789, type: 'private' },
                    from: { id: 123456789, is_bot: false, first_name: 'Alice' },
                    text: '/start'
                }
            }
        });
        assertStatus(telegramUnauthorized, 401, 'telegram webhook unauthorized');

        const telegramStart = await request(baseUrl, '/v1/telegram/webhook', {
            method: 'POST',
            headers: {
                'X-Telegram-Bot-Api-Secret-Token': telegramSettings.webhookSecret
            },
            json: {
                update_id: 2,
                message: {
                    message_id: 2,
                    chat: { id: 123456789, type: 'private' },
                    from: { id: 123456789, is_bot: false, first_name: 'Alice' },
                    text: '/start'
                }
            }
        });
        assertStatus(telegramStart, 200, 'telegram start');
        assert.equal(fakeTelegram.calls.at(-1)?.method, 'sendMessage');
        assert.match(String(fakeTelegram.calls.at(-1)?.body?.text || ''), /Supported commands:/);

        const telegramUnlinkedStart = await request(baseUrl, '/v1/telegram/webhook', {
            method: 'POST',
            headers: {
                'X-Telegram-Bot-Api-Secret-Token': telegramSettings.webhookSecret
            },
            json: {
                update_id: 21,
                message: {
                    message_id: 21,
                    chat: { id: 999000111, type: 'private' },
                    from: { id: 999000111, is_bot: false, first_name: 'Guest' },
                    text: '/start'
                }
            }
        });
        assertStatus(telegramUnlinkedStart, 200, 'telegram start for unlinked user');
        assert.equal(fakeTelegram.calls.at(-1)?.method, 'sendMessage');
        assert.match(String(fakeTelegram.calls.at(-1)?.body?.text || ''), /Your Telegram user id is: 999000111/);

        const telegramRegisterAlice = await request(baseUrl, '/v1/telegram/webhook', {
            method: 'POST',
            headers: {
                'X-Telegram-Bot-Api-Secret-Token': telegramSettings.webhookSecret
            },
            json: {
                update_id: 3,
                message: {
                    message_id: 3,
                    chat: { id: 123456789, type: 'private' },
                    from: { id: 123456789, is_bot: false, first_name: 'Alice' },
                    text: '/register alice@example.com'
                }
            }
        });
        assertStatus(telegramRegisterAlice, 200, 'telegram register alice mailbox');
        assert.match(String(fakeTelegram.calls.at(-1)?.body?.text || ''), /Registered alice@example.com/);

        const telegramMailboxes = await request(baseUrl, '/v1/telegram/webhook', {
            method: 'POST',
            headers: {
                'X-Telegram-Bot-Api-Secret-Token': telegramSettings.webhookSecret
            },
            json: {
                update_id: 4,
                message: {
                    message_id: 4,
                    chat: { id: 123456789, type: 'private' },
                    from: { id: 123456789, is_bot: false, first_name: 'Alice' },
                    text: '/mailboxes'
                }
            }
        });
        assertStatus(telegramMailboxes, 200, 'telegram mailboxes');
        assert.match(String(fakeTelegram.calls.at(-1)?.body?.text || ''), /alice@example\.com/);

        const telegramDomains = await request(baseUrl, '/v1/telegram/webhook', {
            method: 'POST',
            headers: {
                'X-Telegram-Bot-Api-Secret-Token': telegramSettings.webhookSecret
            },
            json: {
                update_id: 39,
                message: {
                    message_id: 39,
                    chat: { id: 123456789, type: 'private' },
                    from: { id: 123456789, is_bot: false, first_name: 'Alice' },
                    text: '/domains'
                }
            }
        });
        assertStatus(telegramDomains, 200, 'telegram domains');
        assert.match(String(fakeTelegram.calls.at(-1)?.body?.text || ''), /Available domains/);
        assert.match(String(fakeTelegram.calls.at(-1)?.body?.text || ''), /example\.com/);
        assert.match(String(fakeTelegram.calls.at(-1)?.body?.text || ''), /cleanup\.test/);
        assert.doesNotMatch(String(fakeTelegram.calls.at(-1)?.body?.text || ''), /disabled\.test/);
        assert.doesNotMatch(String(fakeTelegram.calls.at(-1)?.body?.text || ''), /inboundoff\.test/);

        const telegramNewMail = await request(baseUrl, '/v1/telegram/webhook', {
            method: 'POST',
            headers: {
                'X-Telegram-Bot-Api-Secret-Token': telegramSettings.webhookSecret
            },
            json: {
                update_id: 40,
                message: {
                    message_id: 40,
                    chat: { id: 123456789, type: 'private' },
                    from: { id: 123456789, is_bot: false, first_name: 'Alice' },
                    text: '/newmail cleanup.test'
                }
            }
        });
        assertStatus(telegramNewMail, 200, 'telegram newmail');
        assert.match(String(fakeTelegram.calls.at(-1)?.body?.text || ''), /^Registered [a-z0-9]+(?:[._-]?[a-z0-9]+)*@cleanup\.test\.$/);

        const telegramNewMailOnDomain = await request(baseUrl, '/v1/telegram/webhook', {
            method: 'POST',
            headers: {
                'X-Telegram-Bot-Api-Secret-Token': telegramSettings.webhookSecret
            },
            json: {
                update_id: 40_1,
                message: {
                    message_id: 40_1,
                    chat: { id: 123456789, type: 'private' },
                    from: { id: 123456789, is_bot: false, first_name: 'Alice' },
                    text: '/newmail example.com'
                }
            }
        });
        assertStatus(telegramNewMailOnDomain, 200, 'telegram newmail with domain');
        assert.match(String(fakeTelegram.calls.at(-1)?.body?.text || ''), /^Registered [a-z0-9]+(?:[._-]?[a-z0-9]+)*@example\.com\.$/);

        const telegramRegisterMissingArg = await request(baseUrl, '/v1/telegram/webhook', {
            method: 'POST',
            headers: {
                'X-Telegram-Bot-Api-Secret-Token': telegramSettings.webhookSecret
            },
            json: {
                update_id: 41,
                message: {
                    message_id: 41,
                    chat: { id: 123456789, type: 'private' },
                    from: { id: 123456789, is_bot: false, first_name: 'Alice' },
                    text: '/register'
                }
            }
        });
        assertStatus(telegramRegisterMissingArg, 200, 'telegram register missing arg');
        assert.match(String(fakeTelegram.calls.at(-1)?.body?.text || ''), /Usage: \/register <email>/);

        const telegramHelpAfterRegisterError = await request(baseUrl, '/v1/telegram/webhook', {
            method: 'POST',
            headers: {
                'X-Telegram-Bot-Api-Secret-Token': telegramSettings.webhookSecret
            },
            json: {
                update_id: 42,
                message: {
                    message_id: 42,
                    chat: { id: 123456789, type: 'private' },
                    from: { id: 123456789, is_bot: false, first_name: 'Alice' },
                    text: '/help'
                }
            }
        });
        assertStatus(telegramHelpAfterRegisterError, 200, 'telegram help after register error');
        assert.match(String(fakeTelegram.calls.at(-1)?.body?.text || ''), /Supported commands:/);

        const createBobDomainPermission = await request(baseUrl, '/v1/permissions', {
            method: 'POST',
            token: adminToken,
            json: {
                userId: bobUserId,
                domain: 'example.com'
            }
        });
        assertStatus(createBobDomainPermission, 201, 'create bob domain permission');
        const bobPermissionId = createBobDomainPermission.body.permission.id;
        assert.ok(bobPermissionId);

        const duplicateBobDomainPermission = await request(baseUrl, '/v1/permissions', {
            method: 'POST',
            token: adminToken,
            json: {
                userId: bobUserId,
                domain: 'example.com'
            }
        });
        assertStatus(duplicateBobDomainPermission, 409, 'duplicate bob domain permission rejected');

        const listBobPermissions = await request(baseUrl, `/v1/permissions?userId=${bobUserId}&domain=example.com`, {
            token: adminToken
        });
        assertStatus(listBobPermissions, 200, 'list bob permissions');
        assert.equal(listBobPermissions.body.count, 1);
        assert.equal(listBobPermissions.body.permissions[0].id, bobPermissionId);

        const ingestAliceEmail = await request(baseUrl, '/v1/inbound/email', {
            method: 'POST',
            token: config.inboundAuthToken,
            body: createMimeMessage({
                to: 'alice@example.com',
                subject: 'Alice smoke email',
                messageId: 'smoke-alice-1@example.net',
                text: 'Hello Alice'
            }),
            headers: {
                'Content-Type': 'message/rfc822',
                'X-Email-Envelope-To': 'alice@example.com',
                'X-Email-Envelope-From': 'sender@example.net',
                'X-Email-Worker-Name': 'smoke-worker'
            }
        });
        assertStatus(ingestAliceEmail, 202, 'ingest alice email');
        await waitFor(() => fakeTelegram.calls.some(call => call.method === 'sendMessage' && /New email received/.test(String(call.body?.text || ''))));
        const healthAfterFirstNotification = await request(baseUrl, '/health');
        assertStatus(healthAfterFirstNotification, 200, 'health after first telegram notification');
        assert.equal(healthAfterFirstNotification.body.telegram.outbox.pending, 0);
        assert.ok(healthAfterFirstNotification.body.telegram.outbox.sent >= 1);

        const ingestSecretEmail = await request(baseUrl, '/v1/inbound/email', {
            method: 'POST',
            token: config.inboundAuthToken,
            body: createMimeMessage({
                to: 'secret@example.com',
                subject: 'Secret smoke email',
                messageId: 'smoke-secret-1@example.net',
                text: 'Top secret'
            }),
            headers: {
                'Content-Type': 'message/rfc822',
                'X-Email-Envelope-To': 'secret@example.com',
                'X-Email-Envelope-From': 'sender@example.net',
                'X-Email-Worker-Name': 'smoke-worker'
            }
        });
        assertStatus(ingestSecretEmail, 202, 'ingest secret email');

        const blockExactSender = await request(baseUrl, '/v1/blocked-senders', {
            method: 'POST',
            token: adminToken,
            json: {
                pattern: 'spammer@blocked.test',
                reason: 'Smoke spam'
            }
        });
        assertStatus(blockExactSender, 201, 'block exact sender');
        assert.equal(blockExactSender.body.blockedSender.patternType, 'email');
        assert.equal(blockExactSender.body.blockedSender.scope, 'global');
        assert.equal(blockExactSender.body.blockedSender.domain, null);
        assert.equal(blockExactSender.body.blockedSender.matchCount, 0);
        const blockExactSenderId = blockExactSender.body.blockedSender.id;

        const blockDuplicateSender = await request(baseUrl, '/v1/blocked-senders', {
            method: 'POST',
            token: adminToken,
            json: {
                pattern: 'spammer@blocked.test'
            }
        });
        assertStatus(blockDuplicateSender, 409, 'duplicate blocked sender rejected');

        const blockSenderDomain = await request(baseUrl, '/v1/blocked-senders', {
            method: 'POST',
            token: adminToken,
            json: {
                pattern: '@ads.test',
                reason: 'Whole ad network'
            }
        });
        assertStatus(blockSenderDomain, 201, 'block sender domain');
        assert.equal(blockSenderDomain.body.blockedSender.patternType, 'domain');
        assert.equal(blockSenderDomain.body.blockedSender.pattern, 'ads.test');
        const blockSenderDomainId = blockSenderDomain.body.blockedSender.id;

        const blockScopedSender = await request(baseUrl, '/v1/blocked-senders', {
            method: 'POST',
            token: adminToken,
            json: {
                pattern: 'scoped@partner.test',
                domain: 'cleanup.test'
            }
        });
        assertStatus(blockScopedSender, 201, 'block sender scoped to one recipient domain');
        assert.equal(blockScopedSender.body.blockedSender.scope, 'domain');
        assert.equal(blockScopedSender.body.blockedSender.domain, 'cleanup.test');
        const blockScopedSenderId = blockScopedSender.body.blockedSender.id;

        const blockedSendersForNonAdmin = await request(baseUrl, '/v1/blocked-senders', {
            token: config.inboundAuthToken
        });
        assertStatus(blockedSendersForNonAdmin, 401, 'inbound token cannot read blocked senders');

        const telegramCallsBeforeBlockedIngest = fakeTelegram.calls.length;

        const ingestBlockedExact = await request(baseUrl, '/v1/inbound/email', {
            method: 'POST',
            token: config.inboundAuthToken,
            body: createMimeMessage({
                to: 'alice@example.com',
                subject: 'Blocked exact sender',
                messageId: 'smoke-blocked-1@blocked.test',
                text: 'Should not be stored'
            }),
            headers: {
                'Content-Type': 'message/rfc822',
                'X-Email-Envelope-To': 'alice@example.com',
                'X-Email-Envelope-From': 'spammer@blocked.test',
                'X-Email-Worker-Name': 'smoke-worker'
            }
        });
        assertStatus(ingestBlockedExact, 202, 'ingest blocked exact sender');
        assert.equal(ingestBlockedExact.body.blocked, true);
        assert.equal(ingestBlockedExact.body.id, null);
        assert.equal(ingestBlockedExact.body.blockedBy.patternType, 'email');
        assert.equal(ingestBlockedExact.body.blockedBy.pattern, 'spammer@blocked.test');
        assert.equal(ingestBlockedExact.body.blockedBy.sender, 'spammer@blocked.test');

        const ingestBlockedSubdomain = await request(baseUrl, '/v1/inbound/email', {
            method: 'POST',
            token: config.inboundAuthToken,
            body: createMimeMessage({
                to: 'alice@example.com',
                subject: 'Blocked sender subdomain',
                messageId: 'smoke-blocked-2@mail.ads.test',
                text: 'Should not be stored'
            }),
            headers: {
                'Content-Type': 'message/rfc822',
                'X-Email-Envelope-To': 'alice@example.com',
                'X-Email-Envelope-From': 'promo@mail.ads.test',
                'X-Email-Worker-Name': 'smoke-worker'
            }
        });
        assertStatus(ingestBlockedSubdomain, 202, 'ingest blocked sender subdomain');
        assert.equal(ingestBlockedSubdomain.body.blocked, true);
        assert.equal(ingestBlockedSubdomain.body.blockedBy.patternType, 'domain');
        assert.equal(ingestBlockedSubdomain.body.blockedBy.pattern, 'ads.test');

        const ingestScopedSenderOnOtherDomain = await request(baseUrl, '/v1/inbound/email', {
            method: 'POST',
            token: config.inboundAuthToken,
            body: createMimeMessage({
                to: 'alice@example.com',
                subject: 'Scoped block does not apply here',
                messageId: 'smoke-scoped-pass@partner.test',
                text: 'Should be stored'
            }),
            headers: {
                'Content-Type': 'message/rfc822',
                'X-Email-Envelope-To': 'alice@example.com',
                'X-Email-Envelope-From': 'scoped@partner.test',
                'X-Email-Worker-Name': 'smoke-worker'
            }
        });
        assertStatus(ingestScopedSenderOnOtherDomain, 202, 'domain-scoped block does not affect other domains');
        assert.equal(ingestScopedSenderOnOtherDomain.body.blocked, false);
        assert.ok(Number.isInteger(ingestScopedSenderOnOtherDomain.body.id));
        const scopedPassEmailId = ingestScopedSenderOnOtherDomain.body.id;

        const ingestScopedSenderOnBlockedDomain = await request(baseUrl, '/v1/inbound/email', {
            method: 'POST',
            token: config.inboundAuthToken,
            body: createMimeMessage({
                to: 'cleanup@cleanup.test',
                subject: 'Scoped block applies here',
                messageId: 'smoke-scoped-block@partner.test',
                text: 'Should not be stored'
            }),
            headers: {
                'Content-Type': 'message/rfc822',
                'X-Email-Envelope-To': 'cleanup@cleanup.test',
                'X-Email-Envelope-From': 'scoped@partner.test',
                'X-Email-Worker-Name': 'smoke-worker'
            }
        });
        assertStatus(ingestScopedSenderOnBlockedDomain, 202, 'domain-scoped block applies to its own domain');
        assert.equal(ingestScopedSenderOnBlockedDomain.body.blocked, true);
        assert.equal(ingestScopedSenderOnBlockedDomain.body.blockedBy.scope, 'domain');

        const blockedExactAfterHits = await request(baseUrl, `/v1/blocked-senders/${blockExactSenderId}`, {
            token: adminToken
        });
        assertStatus(blockedExactAfterHits, 200, 'read blocked sender after hits');
        assert.equal(blockedExactAfterHits.body.blockedSender.matchCount, 1);
        assert.ok(blockedExactAfterHits.body.blockedSender.lastMatchedAt);

        const disableBlockedDomain = await request(baseUrl, `/v1/blocked-senders/${blockSenderDomainId}`, {
            method: 'PATCH',
            token: adminToken,
            json: {
                status: 'disabled'
            }
        });
        assertStatus(disableBlockedDomain, 200, 'disable blocked sender domain');
        assert.equal(disableBlockedDomain.body.blockedSender.status, 'disabled');

        const ingestAfterDisable = await request(baseUrl, '/v1/inbound/email', {
            method: 'POST',
            token: config.inboundAuthToken,
            body: createMimeMessage({
                to: 'alice@example.com',
                subject: 'Allowed after disabling block',
                messageId: 'smoke-unblocked@mail.ads.test',
                text: 'Should be stored now'
            }),
            headers: {
                'Content-Type': 'message/rfc822',
                'X-Email-Envelope-To': 'alice@example.com',
                'X-Email-Envelope-From': 'promo@mail.ads.test',
                'X-Email-Worker-Name': 'smoke-worker'
            }
        });
        assertStatus(ingestAfterDisable, 202, 'ingest after disabling block');
        assert.equal(ingestAfterDisable.body.blocked, false);
        assert.ok(Number.isInteger(ingestAfterDisable.body.id));

        // Blocked mail must never reach the notification pipeline; only the two
        // deliberately-allowed messages above may have queued anything.
        const blockedIngestTelegramCalls = fakeTelegram.calls
            .slice(telegramCallsBeforeBlockedIngest)
            .filter(call => call.method === 'sendMessage');
        assert.ok(
            blockedIngestTelegramCalls.length <= 2,
            `blocked emails must not notify Telegram, saw ${blockedIngestTelegramCalls.length} sendMessage calls`
        );

        // Drop the two allowed messages so later inbox assertions keep their counts.
        const cleanupBlockedSenderFixtures = await request(baseUrl, '/v1/emails/bulk-delete', {
            method: 'POST',
            token: adminToken,
            json: {
                emailIds: [scopedPassEmailId, ingestAfterDisable.body.id]
            }
        });
        assertStatus(cleanupBlockedSenderFixtures, 200, 'cleanup blocked sender fixture emails');
        assert.equal(cleanupBlockedSenderFixtures.body.deleted, 2);

        const listBlockedSenders = await request(baseUrl, '/v1/blocked-senders?patternType=email', {
            token: adminToken
        });
        assertStatus(listBlockedSenders, 200, 'list blocked senders filtered by pattern type');
        assert.equal(listBlockedSenders.body.total, 2);
        assert.ok(listBlockedSenders.body.blockedSenders.every(item => item.patternType === 'email'));

        const listGlobalBlockedSenders = await request(baseUrl, '/v1/blocked-senders?scope=global', {
            token: adminToken
        });
        assertStatus(listGlobalBlockedSenders, 200, 'list global blocked senders');
        assert.ok(listGlobalBlockedSenders.body.blockedSenders.every(item => item.scope === 'global'));

        const deleteScopedBlockedSender = await request(baseUrl, `/v1/blocked-senders/${blockScopedSenderId}`, {
            method: 'DELETE',
            token: adminToken
        });
        assertStatus(deleteScopedBlockedSender, 200, 'delete scoped blocked sender');

        const readDeletedBlockedSender = await request(baseUrl, `/v1/blocked-senders/${blockScopedSenderId}`, {
            token: adminToken
        });
        assertStatus(readDeletedBlockedSender, 404, 'deleted blocked sender is gone');

        const aliceLogin = await request(baseUrl, '/v1/auth/login', {
            method: 'POST',
            json: {
                username: 'alice',
                password: 'alice-pass-123'
            }
        });
        assertStatus(aliceLogin, 200, 'alice login');
        const aliceToken = aliceLogin.body.sessionToken;
        assert.ok(aliceToken);
        assert.equal(aliceLogin.body.account.isAdmin, false);

        const rotateApiKey = await request(baseUrl, '/v1/auth/me/api-key/rotate', {
            method: 'POST',
            token: aliceToken,
            json: {}
        });
        assertStatus(rotateApiKey, 200, 'rotate own api key');
        const aliceApiKey = rotateApiKey.body.apiKey;
        assert.ok(aliceApiKey);

        const authMeViaApiKey = await request(baseUrl, '/v1/auth/me', {
            apiKey: aliceApiKey
        });
        assertStatus(authMeViaApiKey, 200, 'auth me via api key');
        assert.equal(authMeViaApiKey.body.account.username, 'alice');

        const registerAliceMailbox = await request(baseUrl, '/v1/email-registers', {
            method: 'POST',
            token: aliceToken,
            json: {
                emailAddress: 'alice@example.com'
            }
        });
        assertStatus(registerAliceMailbox, 201, 'register alice mailbox');
        assert.equal(registerAliceMailbox.body.registration.emailAddress, 'alice@example.com');

        const registerCleanupMailbox = await request(baseUrl, '/v1/email-registers', {
            method: 'POST',
            token: aliceToken,
            json: {
                emailAddress: 'cleanup@cleanup.test'
            }
        });
        assertStatus(registerCleanupMailbox, 201, 'register cleanup mailbox');
        assert.equal(registerCleanupMailbox.body.registration.emailAddress, 'cleanup@cleanup.test');

        const listAliceRegisters = await request(baseUrl, '/v1/email-registers', {
            token: aliceToken
        });
        assertStatus(listAliceRegisters, 200, 'list alice registrations');
        assert.equal(listAliceRegisters.body.count, 4);

        const searchAliceRegisters = await request(baseUrl, '/v1/email-registers?search=ALICE%40example', {
            token: aliceToken
        });
        assertStatus(searchAliceRegisters, 200, 'search alice registrations');
        assert.equal(searchAliceRegisters.body.total, 1);
        assert.equal(searchAliceRegisters.body.count, 1);
        assert.equal(searchAliceRegisters.body.registrations[0].emailAddress, 'alice@example.com');

        const searchAliceRegistersNoMatch = await request(baseUrl, '/v1/email-registers?search=no-such-mailbox', {
            token: aliceToken
        });
        assertStatus(searchAliceRegistersNoMatch, 200, 'search alice registrations without match');
        assert.equal(searchAliceRegistersNoMatch.body.total, 0);
        assert.equal(searchAliceRegistersNoMatch.body.count, 0);

        const searchAliceRegistersPaged = await request(baseUrl, '/v1/email-registers?search=example.com&limit=1&offset=0', {
            token: aliceToken
        });
        assertStatus(searchAliceRegistersPaged, 200, 'search alice registrations with pagination');
        assert.ok(searchAliceRegistersPaged.body.total >= 2);
        assert.equal(searchAliceRegistersPaged.body.count, 1);

        const bobLogin = await request(baseUrl, '/v1/auth/login', {
            method: 'POST',
            json: {
                username: 'bob',
                password: 'bob-pass-123'
            }
        });
        assertStatus(bobLogin, 200, 'bob login');
        const bobToken = bobLogin.body.sessionToken;

        const registerLegacyMailbox = await request(baseUrl, '/v1/email-registers', {
            method: 'POST',
            token: bobToken,
            json: {
                emailAddress: 'legacy@example.com'
            }
        });
        assertStatus(registerLegacyMailbox, 201, 'register legacy mailbox for prune');

        const ingestLegacyEmail = await request(baseUrl, '/v1/inbound/email', {
            method: 'POST',
            token: config.inboundAuthToken,
            body: createMimeMessage({
                to: 'legacy@example.com',
                subject: 'Legacy email',
                messageId: 'smoke-legacy-1@example.net',
                text: 'Very old email'
            }),
            headers: {
                'Content-Type': 'message/rfc822',
                'X-Email-Envelope-To': 'legacy@example.com',
                'X-Email-Envelope-From': 'sender@example.net',
                'X-Email-Received-At': '2020-01-01T00:00:00.000Z',
                'X-Email-Worker-Name': 'smoke-worker'
            }
        });
        assertStatus(ingestLegacyEmail, 202, 'ingest legacy email');

        const pruneEmailsDryRun = await request(baseUrl, '/v1/maintenance/prune-emails', {
            method: 'POST',
            token: adminToken,
            json: {
                olderThanDays: 365,
                domain: 'example.com',
                dryRun: true,
                limit: 10
            }
        });
        assertStatus(pruneEmailsDryRun, 200, 'prune emails dry run');
        assert.equal(pruneEmailsDryRun.body.dryRun, true);
        assert.equal(pruneEmailsDryRun.body.domain, 'example.com');
        assert.equal(pruneEmailsDryRun.body.matched, 1);
        assert.equal(pruneEmailsDryRun.body.selected, 1);
        assert.equal(pruneEmailsDryRun.body.deleted, 0);
        assert.equal(pruneEmailsDryRun.body.hasMore, false);

        const storageBeforePrune = await request(baseUrl, '/v1/maintenance/storage', {
            token: adminToken
        });
        assertStatus(storageBeforePrune, 200, 'maintenance storage before prune');
        assert.ok(storageBeforePrune.body.storage.sqliteTotalBytes >= 0);
        assert.ok(storageBeforePrune.body.storage.folderBytes >= storageBeforePrune.body.storage.sqliteTotalBytes);

        const pruneEmailsRun = await request(baseUrl, '/v1/maintenance/prune-emails', {
            method: 'POST',
            token: adminToken,
            json: {
                olderThanDays: 365,
                domain: 'example.com',
                dryRun: false,
                limit: 10
            }
        });
        assertStatus(pruneEmailsRun, 200, 'prune emails run');
        assert.equal(pruneEmailsRun.body.dryRun, false);
        assert.equal(pruneEmailsRun.body.deleted, 1);
        assert.equal(pruneEmailsRun.body.hasMore, false);
        assert.ok(pruneEmailsRun.body.vacuum);
        assert.ok(pruneEmailsRun.body.vacuum.before.totalBytes >= 0);
        assert.ok(pruneEmailsRun.body.vacuum.after.totalBytes >= 0);

        const legacyInboxAfterPrune = await request(baseUrl, '/v1/inboxes/legacy%40example.com', {
            token: bobToken
        });
        assertStatus(legacyInboxAfterPrune, 200, 'legacy inbox after prune');
        assert.equal(legacyInboxAfterPrune.body.count, 0);

        const bobCannotRegisterAliceMailbox = await request(baseUrl, '/v1/email-registers', {
            method: 'POST',
            token: bobToken,
            json: {
                emailAddress: 'alice@example.com'
            }
        });
        assertStatus(bobCannotRegisterAliceMailbox, 409, 'bob cannot register claimed mailbox');

        const bobEmailList = await request(baseUrl, '/v1/emails', {
            token: bobToken
        });
        assertStatus(bobEmailList, 200, 'bob email list without registrations');
        assert.equal(bobEmailList.body.count, 0);

        const aliceInbox = await request(baseUrl, '/v1/inboxes/alice%40example.com', {
            token: aliceToken
        });
        assertStatus(aliceInbox, 200, 'alice inbox');
        assert.equal(aliceInbox.body.count, 1);
        const allowedEmailId = aliceInbox.body.emails[0].id;
        assert.ok(allowedEmailId);
        const firstAliceReceivedAt = aliceInbox.body.emails[0].receivedAt;
        assert.ok(firstAliceReceivedAt);

        // The list must return a short preview instead of the full body,
        // otherwise the payload grows with the mail count and the UI
        // stutters on large mailboxes.
        const inboxListedEmail = aliceInbox.body.emails[0];
        assert.equal('text' in inboxListedEmail, false, 'inbox list must not embed full text body');
        assert.equal('html' in inboxListedEmail, false, 'inbox list must not embed full html body');
        assert.equal(typeof inboxListedEmail.preview, 'string');
        assert.ok(inboxListedEmail.preview.length <= 400, 'preview must stay bounded');
        assert.equal(inboxListedEmail.hasText, true);
        assert.equal(typeof inboxListedEmail.hasHtml, 'boolean');

        const aliceEmailListShape = await request(baseUrl, '/v1/emails?limit=5', {
            token: aliceToken
        });
        assertStatus(aliceEmailListShape, 200, 'alice email list shape');
        assert.ok(aliceEmailListShape.body.emails.length >= 1);
        for (const listedEmail of aliceEmailListShape.body.emails) {
            assert.equal('text' in listedEmail, false, 'email list must not embed full text body');
            assert.equal('html' in listedEmail, false, 'email list must not embed full html body');
            assert.equal(typeof listedEmail.preview, 'string');
        }

        // The detail view must still return the full body so the modal can render it.
        const aliceEmailDetail = await request(baseUrl, `/v1/emails/${allowedEmailId}`, {
            token: aliceToken
        });
        assertStatus(aliceEmailDetail, 200, 'alice email detail keeps full body');
        assert.equal(typeof aliceEmailDetail.body.email.text, 'string');
        assert.ok(aliceEmailDetail.body.email.text.includes('Hello Alice'));
        assert.equal(typeof aliceEmailDetail.body.email.html, 'string');
        const firstAliceReceivedAtMs = Date.parse(firstAliceReceivedAt);
        assert.ok(Number.isFinite(firstAliceReceivedAtMs));

        fakeTelegram.state.failSendMessageCount = 1;
        const ingestAliceEmailSecond = await request(baseUrl, '/v1/inbound/email', {
            method: 'POST',
            token: config.inboundAuthToken,
            body: createMimeMessage({
                to: 'alice@example.com',
                subject: 'Alice smoke email 2',
                messageId: 'smoke-alice-2@example.net',
                text: 'Hello Alice again'
            }),
            headers: {
                'Content-Type': 'message/rfc822',
                'X-Email-Envelope-To': 'alice@example.com',
                'X-Email-Envelope-From': 'sender@example.net',
                'X-Email-Worker-Name': 'smoke-worker'
            }
        });
        assertStatus(ingestAliceEmailSecond, 202, 'ingest second alice email');
        await waitFor(() => fakeTelegram.calls.filter(call => call.method === 'sendMessage' && /Alice smoke email 2/.test(String(call.body?.text || ''))).length >= 2);
        const healthAfterRetry = await request(baseUrl, '/health');
        assertStatus(healthAfterRetry, 200, 'health after telegram retry');
        assert.equal(healthAfterRetry.body.telegram.outbox.pending, 0);
        assert.equal(healthAfterRetry.body.telegram.outbox.failed, 0);
        assert.ok(healthAfterRetry.body.telegram.outbox.sent >= 2);

        const aliceInboxCursorPage1 = await request(baseUrl, '/v1/inboxes/alice%40example.com?limit=1', {
            token: aliceToken
        });
        assertStatus(aliceInboxCursorPage1, 200, 'alice inbox cursor page 1');
        assert.equal(aliceInboxCursorPage1.body.count, 1);
        assert.equal(aliceInboxCursorPage1.body.hasMore, true);
        assert.ok(aliceInboxCursorPage1.body.nextCursor);
        const latestAliceEmailId = aliceInboxCursorPage1.body.emails[0].id;
        assert.ok(latestAliceEmailId);

        const aliceInboxCursorPage2 = await request(baseUrl, `/v1/inboxes/alice%40example.com?limit=1&cursor=${encodeURIComponent(aliceInboxCursorPage1.body.nextCursor)}`, {
            token: aliceToken
        });
        assertStatus(aliceInboxCursorPage2, 200, 'alice inbox cursor page 2');
        assert.equal(aliceInboxCursorPage2.body.count, 1);
        assert.equal(aliceInboxCursorPage2.body.emails[0].id, allowedEmailId);
        assert.equal(aliceInboxCursorPage2.body.hasMore, false);
        assert.equal(aliceInboxCursorPage2.body.nextCursor, null);

        const aliceInboxSince = await request(baseUrl, `/v1/inboxes/alice%40example.com?stime=${firstAliceReceivedAtMs}`, {
            token: aliceToken
        });
        assertStatus(aliceInboxSince, 200, 'alice inbox since time');
        assert.equal(aliceInboxSince.body.count, 1);
        assert.equal(aliceInboxSince.body.emails[0].subject, 'Alice smoke email 2');

        const ingestCleanupEmail = await request(baseUrl, '/v1/inbound/email', {
            method: 'POST',
            token: config.inboundAuthToken,
            body: createMimeMessage({
                to: 'cleanup@cleanup.test',
                subject: 'Cleanup smoke email',
                messageId: 'smoke-cleanup-1@example.net',
                text: 'Cleanup me'
            }),
            headers: {
                'Content-Type': 'message/rfc822',
                'X-Email-Envelope-To': 'cleanup@cleanup.test',
                'X-Email-Envelope-From': 'sender@example.net',
                'X-Email-Worker-Name': 'smoke-worker'
            }
        });
        assertStatus(ingestCleanupEmail, 202, 'ingest cleanup email');

        const cleanupInbox = await request(baseUrl, '/v1/inboxes/cleanup%40cleanup.test', {
            token: aliceToken
        });
        assertStatus(cleanupInbox, 200, 'cleanup inbox');
        assert.equal(cleanupInbox.body.count, 1);
        const cleanupEmailId = cleanupInbox.body.emails[0].id;
        assert.ok(cleanupEmailId);

        const secretInbox = await request(baseUrl, '/v1/inboxes/secret%40example.com', {
            token: adminToken
        });
        assertStatus(secretInbox, 200, 'secret inbox');
        assert.equal(secretInbox.body.count, 1);
        const deniedEmailId = secretInbox.body.emails[0].id;
        assert.ok(deniedEmailId);

        const deleteCleanupDomain = await request(baseUrl, '/v1/domains/cleanup.test', {
            method: 'DELETE',
            token: adminToken
        });
        assertStatus(deleteCleanupDomain, 200, 'delete cleanup domain');

        const listAliceRegistersAfterDomainDelete = await request(baseUrl, '/v1/email-registers', {
            token: aliceToken
        });
        assertStatus(listAliceRegistersAfterDomainDelete, 200, 'list registrations after domain delete');
        assert.equal(listAliceRegistersAfterDomainDelete.body.count, 2);
        assert.ok(listAliceRegistersAfterDomainDelete.body.registrations.some((item) => item.emailAddress === 'alice@example.com'));
        assert.ok(listAliceRegistersAfterDomainDelete.body.registrations.every((item) => item.domain === 'example.com'));

        const registerArchiveMailbox = await request(baseUrl, '/v1/email-registers', {
            method: 'POST',
            token: aliceToken,
            json: {
                emailAddress: 'archive@example.com'
            }
        });
        assertStatus(registerArchiveMailbox, 201, 'register archive mailbox');

        const ingestArchiveEmailOne = await request(baseUrl, '/v1/inbound/email', {
            method: 'POST',
            token: config.inboundAuthToken,
            body: createMimeMessage({
                to: 'archive@example.com',
                subject: 'Archive email 1',
                messageId: 'smoke-archive-1@example.net',
                text: 'Archive one'
            }),
            headers: {
                'Content-Type': 'message/rfc822',
                'X-Email-Envelope-To': 'archive@example.com',
                'X-Email-Envelope-From': 'sender@example.net',
                'X-Email-Worker-Name': 'smoke-worker'
            }
        });
        assertStatus(ingestArchiveEmailOne, 202, 'ingest archive email 1');

        const ingestArchiveEmailTwo = await request(baseUrl, '/v1/inbound/email', {
            method: 'POST',
            token: config.inboundAuthToken,
            body: createMimeMessage({
                to: 'archive@example.com',
                subject: 'Archive email 2',
                messageId: 'smoke-archive-2@example.net',
                text: 'Archive two'
            }),
            headers: {
                'Content-Type': 'message/rfc822',
                'X-Email-Envelope-To': 'archive@example.com',
                'X-Email-Envelope-From': 'sender@example.net',
                'X-Email-Worker-Name': 'smoke-worker'
            }
        });
        assertStatus(ingestArchiveEmailTwo, 202, 'ingest archive email 2');

        const archiveInbox = await request(baseUrl, '/v1/inboxes/archive%40example.com', {
            token: aliceToken
        });
        assertStatus(archiveInbox, 200, 'archive inbox');
        const archiveEmailIds = archiveInbox.body.emails.map(email => email.id).sort((left, right) => left - right);
        assert.equal(archiveEmailIds.length, 2);

        const deleteArchiveEmail = await request(baseUrl, `/v1/emails/${archiveEmailIds[0]}`, {
            method: 'DELETE',
            token: aliceToken
        });
        assertStatus(deleteArchiveEmail, 200, 'delete single archive email');

        const clearArchiveInbox = await request(baseUrl, '/v1/inboxes/archive%40example.com', {
            method: 'DELETE',
            token: aliceToken
        });
        assertStatus(clearArchiveInbox, 200, 'clear archive inbox');

        const deletePermission = await request(baseUrl, `/v1/permissions/${permissionId}`, {
            method: 'DELETE',
            token: adminToken
        });
        assertStatus(deletePermission, 200, 'delete permission');

        const listAliceRegistersAfterPermissionDelete = await request(baseUrl, '/v1/email-registers', {
            token: aliceToken
        });
        assertStatus(listAliceRegistersAfterPermissionDelete, 200, 'list registrations after permission delete');
        assert.equal(listAliceRegistersAfterPermissionDelete.body.count, 0);

        // ---------- wildcard subdomains ----------
        // A registered domain receives mail for all of its subdomains; the
        // exact recipient is preserved while the mail is filed under the
        // registered parent domain.
        const ingestSubdomainEmail = await request(baseUrl, '/v1/inbound/email', {
            method: 'POST',
            token: config.inboundAuthToken,
            body: createMimeMessage({
                to: 'user@abc.example.com',
                subject: 'Wildcard subdomain email',
                messageId: 'smoke-wildcard-1@example.net',
                text: 'Hello subdomain'
            }),
            headers: {
                'Content-Type': 'message/rfc822',
                'X-Email-Envelope-To': 'user@abc.example.com',
                'X-Email-Envelope-From': 'sender@example.net',
                'X-Email-Worker-Name': 'smoke-worker'
            }
        });
        assertStatus(ingestSubdomainEmail, 202, 'ingest subdomain email');
        assert.equal(ingestSubdomainEmail.body.blocked, false);
        assert.equal(ingestSubdomainEmail.body.domain, 'example.com');

        const ingestDeepSubdomainEmail = await request(baseUrl, '/v1/inbound/email', {
            method: 'POST',
            token: config.inboundAuthToken,
            body: createMimeMessage({
                to: 'user@foo.bar.example.com',
                subject: 'Deep wildcard email',
                messageId: 'smoke-wildcard-2@example.net',
                text: 'Hello deep subdomain'
            }),
            headers: {
                'Content-Type': 'message/rfc822',
                'X-Email-Envelope-To': 'user@foo.bar.example.com',
                'X-Email-Envelope-From': 'sender@example.net',
                'X-Email-Worker-Name': 'smoke-worker'
            }
        });
        assertStatus(ingestDeepSubdomainEmail, 202, 'ingest deep subdomain email');

        const readDeepSubdomainEmail = await request(baseUrl, `/v1/emails/${ingestDeepSubdomainEmail.body.id}`, {
            token: adminToken
        });
        assertStatus(readDeepSubdomainEmail, 200, 'read deep subdomain email');
        assert.equal(readDeepSubdomainEmail.body.email.to, 'user@foo.bar.example.com');
        assert.equal(readDeepSubdomainEmail.body.email.domain, 'foo.bar.example.com');

        const systemEmailsForParent = await request(baseUrl, '/v1/emails?scope=system&domain=example.com&limit=100', {
            token: adminToken
        });
        assertStatus(systemEmailsForParent, 200, 'system emails filtered by parent domain');
        assert.ok(
            systemEmailsForParent.body.emails.some(email => email.to === 'user@abc.example.com'),
            'parent domain filter includes subdomain mail'
        );

        const newMailUnderSubdomain = await request(baseUrl, '/v1/email-registers/new-mail?domain=abc.example.com', {
            token: adminToken
        });
        assertStatus(newMailUnderSubdomain, 200, 'random mailbox under subdomain');
        assert.equal(newMailUnderSubdomain.body.registration.domain, 'abc.example.com');
        assert.match(newMailUnderSubdomain.body.registration.emailAddress, /@abc\.example\.com$/);

        const ingestUnknownSubdomain = await request(baseUrl, '/v1/inbound/email', {
            method: 'POST',
            token: config.inboundAuthToken,
            body: createMimeMessage({
                to: 'user@x.unknown.test',
                subject: 'Unregistered subdomain',
                messageId: 'smoke-wildcard-3@unknown.test',
                text: 'Should be rejected'
            }),
            headers: {
                'Content-Type': 'message/rfc822',
                'X-Email-Envelope-To': 'user@x.unknown.test',
                'X-Email-Envelope-From': 'sender@example.net'
            }
        });
        assertStatus(ingestUnknownSubdomain, 422, 'subdomain of unregistered domain rejected');

        const newMailUnknownSubdomain = await request(baseUrl, '/v1/email-registers/new-mail?domain=x.unknown.test', {
            token: adminToken
        });
        assertStatus(newMailUnknownSubdomain, 404, 'random mailbox under unregistered subdomain rejected');

        const ingestDisabledSubdomain = await request(baseUrl, '/v1/inbound/email', {
            method: 'POST',
            token: config.inboundAuthToken,
            body: createMimeMessage({
                to: 'user@sub.disabled.test',
                subject: 'Disabled parent subdomain',
                messageId: 'smoke-wildcard-4@disabled.test',
                text: 'Should be rejected'
            }),
            headers: {
                'Content-Type': 'message/rfc822',
                'X-Email-Envelope-To': 'user@sub.disabled.test',
                'X-Email-Envelope-From': 'sender@example.net'
            }
        });
        assertStatus(ingestDisabledSubdomain, 409, 'subdomain of disabled domain rejected');

        // ---------- maintenance: clear all emails ----------
        const clearEmailsAsNonAdmin = await request(baseUrl, '/v1/maintenance/clear-emails', {
            method: 'POST',
            token: aliceToken
        });
        assertStatus(clearEmailsAsNonAdmin, 403, 'clear emails requires super admin');

        const clearAllEmails = await request(baseUrl, '/v1/maintenance/clear-emails', {
            method: 'POST',
            token: adminToken
        });
        assertStatus(clearAllEmails, 200, 'clear all emails');
        assert.equal(clearAllEmails.body.success, true);
        assert.ok(clearAllEmails.body.deletedEmails > 0);

        const emailsAfterClear = await request(baseUrl, '/v1/emails?scope=system&limit=10', {
            token: adminToken
        });
        assertStatus(emailsAfterClear, 200, 'list emails after clear');
        assert.equal(emailsAfterClear.body.count, 0);

        console.log('server smoke test passed');
    } finally {
        await stopServer(server);
        await stopTelegramRuntime();
        await stopServer(fakeTelegram?.server);
        await closeDb();
        await rm(tempRoot, { recursive: true, force: true });
    }
}

await main();
