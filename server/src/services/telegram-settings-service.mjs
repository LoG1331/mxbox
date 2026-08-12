import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';
import { getDb } from '../db/index.mjs';
import { HttpError } from '../utils/http.mjs';

const SETTINGS_KEY = 'telegram.bot';
const ALGORITHM = 'aes-256-gcm';

const DEFAULT_TELEGRAM_SETTINGS = Object.freeze({
    enabled: false,
    botToken: '',
    publicBaseUrl: '',
    webhookSecret: '',
    botTokenConfigured: false,
    botTokenMasked: '',
    updatedAt: null
});

function nowIso() {
    return new Date().toISOString();
}

function cleanText(value) {
    return String(value ?? '').trim();
}

function unique(values) {
    return [...new Set(values.filter(Boolean))];
}

function getEncryptionKey(jwtSecret, apiKeyPepper) {
    return createHash('sha256')
        .update(`${jwtSecret}:${apiKeyPepper}`)
        .digest();
}

function getDecryptionKeyPairs(config) {
    const jwtSecrets = unique([config.jwtSecret, ...(config.legacyJwtSecrets || [])]);
    const apiKeyPeppers = unique([config.apiKeyPepper, ...(config.legacyApiKeyPeppers || [])]);
    const pairs = [];

    for (const jwtSecret of jwtSecrets) {
        for (const apiKeyPepper of apiKeyPeppers) {
            pairs.push({ jwtSecret, apiKeyPepper });
        }
    }

    return pairs;
}

function encryptSecret(config, plaintext) {
    const normalized = cleanText(plaintext);
    if (!normalized) {
        return '';
    }

    const iv = randomBytes(12);
    const cipher = createCipheriv(ALGORITHM, getEncryptionKey(config.jwtSecret, config.apiKeyPepper), iv);
    const encrypted = Buffer.concat([
        cipher.update(normalized, 'utf8'),
        cipher.final()
    ]);
    const tag = cipher.getAuthTag();
    return JSON.stringify({
        iv: iv.toString('base64url'),
        tag: tag.toString('base64url'),
        data: encrypted.toString('base64url')
    });
}

function decryptSecret(config, payload) {
    const normalized = cleanText(payload);
    if (!normalized) {
        return '';
    }

    try {
        const parsed = JSON.parse(normalized);
        for (const { jwtSecret, apiKeyPepper } of getDecryptionKeyPairs(config)) {
            try {
                const decipher = createDecipheriv(
                    ALGORITHM,
                    getEncryptionKey(jwtSecret, apiKeyPepper),
                    Buffer.from(parsed.iv, 'base64url')
                );
                decipher.setAuthTag(Buffer.from(parsed.tag, 'base64url'));
                return Buffer.concat([
                    decipher.update(Buffer.from(parsed.data, 'base64url')),
                    decipher.final()
                ]).toString('utf8');
            } catch {
                continue;
            }
        }
    } catch {
        throw new Error('Failed to decrypt Telegram settings');
    }

    throw new Error('Failed to decrypt Telegram settings');
}

function maskBotToken(botToken) {
    const token = cleanText(botToken);
    if (!token) {
        return '';
    }

    if (token.length <= 8) {
        return `${token.slice(0, 2)}***${token.slice(-2)}`;
    }

    return `${token.slice(0, 6)}...${token.slice(-4)}`;
}

function buildPublicSettings(settings) {
    const botToken = cleanText(settings.botToken);
    return {
        enabled: Boolean(settings.enabled),
        publicBaseUrl: cleanText(settings.publicBaseUrl),
        botTokenConfigured: Boolean(botToken),
        botTokenMasked: maskBotToken(botToken),
        updatedAt: settings.updatedAt || null
    };
}

function generateWebhookSecret() {
    return randomBytes(24).toString('base64url');
}

function buildStoredSettings(config, settings) {
    return JSON.stringify({
        enabled: Boolean(settings.enabled),
        publicBaseUrl: cleanText(settings.publicBaseUrl),
        botTokenEncrypted: encryptSecret(config, settings.botToken),
        webhookSecretEncrypted: encryptSecret(config, settings.webhookSecret)
    });
}

function parseStoredSettings(config, row) {
    if (!row?.value) {
        return { ...DEFAULT_TELEGRAM_SETTINGS };
    }

    let parsed;
    try {
        parsed = JSON.parse(row.value);
    } catch {
        throw new Error('Stored Telegram settings are invalid JSON');
    }

    const botToken = decryptSecret(config, parsed.botTokenEncrypted || '');
    const webhookSecret = decryptSecret(config, parsed.webhookSecretEncrypted || '');
    return {
        enabled: Boolean(parsed.enabled),
        botToken,
        publicBaseUrl: cleanText(parsed.publicBaseUrl),
        webhookSecret,
        updatedAt: row.updated_at || null
    };
}

function validatePublicBaseUrl(value) {
    const normalized = cleanText(value).replace(/\/+$/, '');
    if (!normalized) {
        return '';
    }

    try {
        new URL(normalized);
    } catch {
        throw new HttpError(400, 'publicBaseUrl must be a valid URL');
    }

    return normalized;
}

export async function loadTelegramSettings(config) {
    const db = await getDb(config);
    const row = await db.get(
        `
            SELECT key, value, updated_at
            FROM system_settings
            WHERE key = ?
            LIMIT 1
        `,
        [SETTINGS_KEY]
    );

    const settings = parseStoredSettings(config, row);
    config.telegramSettings = settings;
    return settings;
}

export async function getTelegramSettings(config) {
    if (config.telegramSettings) {
        return config.telegramSettings;
    }

    return loadTelegramSettings(config);
}

export async function getPublicTelegramSettings(config) {
    const settings = await getTelegramSettings(config);
    return buildPublicSettings(settings);
}

async function persistTelegramSettings(config, settings) {
    const timestamp = nowIso();
    const db = await getDb(config);
    await db.run(
        `
            INSERT INTO system_settings (key, value, updated_at)
            VALUES (?, ?, ?)
            ON CONFLICT(key) DO UPDATE SET
                value = excluded.value,
                updated_at = excluded.updated_at
        `,
        [
            SETTINGS_KEY,
            buildStoredSettings(config, settings),
            timestamp
        ]
    );

    const next = {
        ...settings,
        updatedAt: timestamp
    };
    config.telegramSettings = next;
    return next;
}

function resolveNextTelegramSettings(current, payload = {}) {
    const next = {
        ...current
    };

    if (payload.enabled !== undefined) {
        next.enabled = Boolean(payload.enabled);
    }

    if (payload.publicBaseUrl !== undefined) {
        next.publicBaseUrl = validatePublicBaseUrl(payload.publicBaseUrl);
    }

    if (payload.botToken !== undefined) {
        next.botToken = cleanText(payload.botToken);
    }

    if (payload.webhookSecret !== undefined) {
        next.webhookSecret = cleanText(payload.webhookSecret);
    }

    if (payload.clearBotToken === true) {
        next.botToken = '';
    }

    if (!next.webhookSecret) {
        next.webhookSecret = generateWebhookSecret();
    }

    if (next.enabled && !cleanText(next.botToken)) {
        throw new HttpError(400, 'Telegram bot token is required when enabling the bot');
    }

    if (next.enabled && !cleanText(next.publicBaseUrl)) {
        throw new HttpError(400, 'publicBaseUrl is required when enabling the bot');
    }

    return next;
}

export async function replaceTelegramSettings(config, settings) {
    const next = resolveNextTelegramSettings(DEFAULT_TELEGRAM_SETTINGS, settings);
    const persisted = await persistTelegramSettings(config, next);
    return buildPublicSettings(persisted);
}

export async function updateTelegramSettings(config, payload = {}) {
    const current = await getTelegramSettings(config);
    const next = resolveNextTelegramSettings(current, payload);
    const persisted = await persistTelegramSettings(config, next);
    return buildPublicSettings(persisted);
}
