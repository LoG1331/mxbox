import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const openApiPath = path.resolve(__dirname, '..', 'openapi.json');

const documentText = await readFile(openApiPath, 'utf8');
const document = JSON.parse(documentText);

assert.equal(document.openapi, '3.1.0');
assert.equal(document.info?.title, 'server API');
assert.ok(document.info?.version);

for (const requiredPath of [
    '/health',
    '/v1/auth/login',
    '/v1/auth/me',
    '/v1/blocked-senders',
    '/v1/blocked-senders/{blockedSenderId}',
    '/v1/domains',
    '/v1/inbound/email',
    '/v1/maintenance/storage',
    '/v1/system/telegram',
    '/v1/system/telegram/commands/register',
    '/v1/telegram/webhook'
]) {
    assert.ok(document.paths?.[requiredPath], `Missing OpenAPI path: ${requiredPath}`);
}

console.log('server OpenAPI validation passed');
