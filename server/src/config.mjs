import path from 'node:path';
import { fileURLToPath } from 'node:url';

const DEFAULT_TELEGRAM_API_BASE_URL = 'https://api.telegram.org';
const CONFIG_DIR = path.dirname(fileURLToPath(import.meta.url));
const PROJECT_ROOT = path.resolve(CONFIG_DIR, '..', '..');

function parseBoolean(value, defaultValue = false) {
    if (value === undefined || value === null || value === '') {
        return defaultValue;
    }

    const normalized = String(value).trim().toLowerCase();
    return normalized === '1' || normalized === 'true' || normalized === 'yes' || normalized === 'on';
}

function parseInteger(value, defaultValue, { min = Number.MIN_SAFE_INTEGER, max = Number.MAX_SAFE_INTEGER } = {}) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) {
        return defaultValue;
    }

    return Math.min(max, Math.max(min, parsed));
}

function parseList(value) {
    return String(value || '')
        .split(',')
        .map(item => item.trim())
        .filter(Boolean);
}

// Default to trusting only loopback proxies: the common deployment is a
// reverse proxy on the same host, and express-rate-limit throws when
// X-Forwarded-For arrives while trust proxy is false. Remote-sent XFF is
// ignored with this setting, so rate limiting cannot be bypassed.
function parseTrustProxy(value) {
    const normalized = String(value ?? '').trim();
    if (!normalized) {
        return 'loopback';
    }

    const lowered = normalized.toLowerCase();
    if (['1', 'true', 'yes', 'on'].includes(lowered)) {
        return true;
    }

    if (['0', 'false', 'no', 'off'].includes(lowered)) {
        return false;
    }

    if (/^\d+$/.test(normalized)) {
        return Number.parseInt(normalized, 10);
    }

    return normalized; // IP / CIDR / list, interpreted by Express
}

function cleanText(value) {
    return String(value || '').trim();
}

export function loadConfig(env = process.env) {
    const inboundAuthToken = cleanText(env.INBOUND_AUTH_TOKEN);
    const configuredJwtSecret = cleanText(env.AUTH_JWT_SECRET);
    const configuredApiKeyPepper = cleanText(env.API_KEY_PEPPER);
    const config = {
        nodeEnv: env.NODE_ENV || 'development',
        host: env.HOST || '0.0.0.0',
        port: parseInteger(env.PORT, 3001, { min: 1, max: 65535 }),
        sqlitePath: env.NEW_SERVER_SQLITE_PATH || path.resolve(PROJECT_ROOT, 'data', 'new-server.sqlite'),
        frontendDistPath: path.resolve(PROJECT_ROOT, 'frontend', 'dist'),
        inboundAuthToken,
        jwtSecret: configuredJwtSecret,
        apiKeyPepper: configuredApiKeyPepper,
        legacyJwtSecret: '',
        legacyApiKeyPepper: '',
        legacyJwtSecrets: [],
        legacyApiKeyPeppers: [],
        sessionTtlMs: parseInteger(env.SESSION_TTL_MS, 7 * 24 * 60 * 60 * 1000, {
            min: 5 * 60 * 1000,
            max: 365 * 24 * 60 * 60 * 1000
        }),
        sessionTouchIntervalMs: parseInteger(env.SESSION_TOUCH_INTERVAL_MS, 5 * 60 * 1000, {
            min: 30 * 1000,
            max: 24 * 60 * 60 * 1000
        }),
        bootstrapAdminUsername: String(env.BOOTSTRAP_ADMIN_USERNAME || '').trim(),
        bootstrapAdminPassword: String(env.BOOTSTRAP_ADMIN_PASSWORD || ''),
        maxEmailSizeBytes: parseInteger(env.MAX_EMAIL_SIZE_BYTES, 25 * 1024 * 1024, {
            min: 1024,
            max: 50 * 1024 * 1024
        }),
        maxJsonBodyBytes: parseInteger(env.MAX_JSON_BODY_BYTES, 256 * 1024, {
            min: 1024,
            max: 5 * 1024 * 1024
        }),
        corsAllowedOrigins: parseList(env.CORS_ALLOWED_ORIGINS),
        trustProxy: parseTrustProxy(env.TRUST_PROXY),
        autoCreateDomainsOnIngress: parseBoolean(env.AUTO_CREATE_DOMAINS_ON_INGEST, false),
        storeRawMime: parseBoolean(env.STORE_RAW_MIME, true),
        rawMimeRetentionDays: parseInteger(env.RAW_MIME_RETENTION_DAYS, 30, { min: 0, max: 3650 }),
        maintenancePruneIntervalMs: parseInteger(env.MAINTENANCE_PRUNE_INTERVAL_MS, 15 * 60 * 1000, {
            min: 60 * 1000,
            max: 24 * 60 * 60 * 1000
        }),
        inboundRateLimitWindowMs: parseInteger(env.INBOUND_RATE_LIMIT_WINDOW_MS, 60 * 1000, {
            min: 1000,
            max: 24 * 60 * 60 * 1000
        }),
        inboundRateLimitMax: parseInteger(env.INBOUND_RATE_LIMIT_MAX, 120, {
            min: 1,
            max: 100000
        }),
        authRateLimitWindowMs: parseInteger(env.AUTH_RATE_LIMIT_WINDOW_MS, 60 * 1000, {
            min: 1000,
            max: 24 * 60 * 60 * 1000
        }),
        authRateLimitMax: parseInteger(env.AUTH_RATE_LIMIT_MAX, 300, {
            min: 1,
            max: 100000
        }),
        telegramApiBaseUrl: DEFAULT_TELEGRAM_API_BASE_URL,
        telegramWebhookRateLimitWindowMs: 60 * 1000,
        telegramWebhookRateLimitMax: 120,
        telegramOutboxPollIntervalMs: 1000,
        telegramOutboxBatchSize: 10,
        telegramOutboxMaxAttempts: 8,
        telegramOutboxBaseBackoffMs: 5000,
        telegramSettings: null
    };

    if (!config.inboundAuthToken) {
        throw new Error('INBOUND_AUTH_TOKEN is required for server');
    }

    if ((config.bootstrapAdminUsername || config.bootstrapAdminPassword) && (!config.bootstrapAdminUsername || !config.bootstrapAdminPassword)) {
        throw new Error('BOOTSTRAP_ADMIN_USERNAME and BOOTSTRAP_ADMIN_PASSWORD must be configured together');
    }

    try {
        new URL(config.telegramApiBaseUrl);
    } catch {
        throw new Error('Default Telegram API URL is invalid');
    }

    return config;
}
