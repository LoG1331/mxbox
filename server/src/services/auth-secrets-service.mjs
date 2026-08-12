import { randomBytes } from 'node:crypto';
import { getDb } from '../db/index.mjs';

const JWT_SECRET_KEY = 'auth.jwt_secret';
const API_KEY_PEPPER_KEY = 'auth.api_key_pepper';

function cleanText(value) {
    return String(value || '').trim();
}

function unique(values) {
    return [...new Set(values.filter(Boolean))];
}

function nowIso() {
    return new Date().toISOString();
}

function generateSecret() {
    return randomBytes(32).toString('base64url');
}

async function upsertSetting(db, key, value) {
    await db.run(
        `
            INSERT INTO system_settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
        `,
        [key, value, nowIso()]
    );
}

export async function ensureAuthSecrets(config) {
    const db = await getDb(config);
    const rows = await db.all(
        `
            SELECT key, value
            FROM system_settings
            WHERE key IN (?, ?)
        `,
        [JWT_SECRET_KEY, API_KEY_PEPPER_KEY]
    );

    const stored = Object.fromEntries(rows.map(row => [row.key, cleanText(row.value)]));
    const storedJwtSecret = stored[JWT_SECRET_KEY] || '';
    const storedApiKeyPepper = stored[API_KEY_PEPPER_KEY] || '';

    const currentJwtSecret = cleanText(config.jwtSecret) || storedJwtSecret || generateSecret();
    const currentApiKeyPepper = cleanText(config.apiKeyPepper) || storedApiKeyPepper || generateSecret();

    if (!cleanText(config.jwtSecret) && !storedJwtSecret) {
        await upsertSetting(db, JWT_SECRET_KEY, currentJwtSecret);
    }

    if (!cleanText(config.apiKeyPepper) && !storedApiKeyPepper) {
        await upsertSetting(db, API_KEY_PEPPER_KEY, currentApiKeyPepper);
    }

    config.jwtSecret = currentJwtSecret;
    config.apiKeyPepper = currentApiKeyPepper;
    config.legacyJwtSecrets = unique([
        storedJwtSecret,
        cleanText(config.legacyJwtSecret)
    ]).filter(secret => secret !== currentJwtSecret);
    config.legacyApiKeyPeppers = unique([
        storedApiKeyPepper,
        cleanText(config.legacyApiKeyPepper)
    ]).filter(secret => secret !== currentApiKeyPepper);
}
