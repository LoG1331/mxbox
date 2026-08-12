import {
    createHash,
    createHmac,
    randomBytes,
    scrypt as scryptCallback,
    timingSafeEqual
} from 'node:crypto';
import { promisify } from 'node:util';
import { getDb, withTransaction } from '../db/index.mjs';
import { normalizeDomain, parseEmailAddress } from '../utils/email.mjs';
import { HttpError } from '../utils/http.mjs';

const scrypt = promisify(scryptCallback);

const PERMISSION_REQUIREMENTS = {
    view: 1,
    write: 1
};

const USER_STATUS = new Set(['active', 'disabled']);
const PERMISSION_STATUS = new Set(['active', 'disabled']);

function nowIso() {
    return new Date().toISOString();
}

function cleanText(value) {
    return String(value ?? '').trim();
}

function cleanNullableText(value) {
    const normalized = cleanText(value);
    return normalized || null;
}

function parseNumericId(value, label = 'id') {
    const numericValue = Number.parseInt(String(value), 10);
    if (!Number.isInteger(numericValue) || numericValue <= 0) {
        throw new HttpError(400, `Valid ${label} is required`);
    }

    return numericValue;
}

function normalizeUsername(value) {
    const normalized = cleanText(value).toLowerCase();
    if (!/^[a-z0-9._-]{3,64}$/.test(normalized)) {
        throw new HttpError(400, 'Username must be 3-64 chars and only contain a-z, 0-9, ., _, -');
    }

    return normalized;
}

function normalizeTelegramId(value) {
    const normalized = cleanText(value);
    if (!normalized) {
        return null;
    }

    if (!/^\d{5,32}$/.test(normalized)) {
        throw new HttpError(400, 'telegramId must be a numeric Telegram user id');
    }

    return normalized;
}

function normalizeUserStatus(value, fallback = 'active') {
    const normalized = cleanText(value).toLowerCase();
    if (!normalized) {
        return fallback;
    }

    if (!USER_STATUS.has(normalized)) {
        throw new HttpError(400, `Unsupported user status: ${value}`);
    }

    return normalized;
}

function normalizePermissionStatus(value, fallback = 'active') {
    const normalized = cleanText(value).toLowerCase();
    if (!normalized) {
        return fallback;
    }

    if (!PERMISSION_STATUS.has(normalized)) {
        throw new HttpError(400, `Unsupported permission status: ${value}`);
    }

    return normalized;
}

function normalizePasswordInput(password) {
    const normalized = String(password || '');
    if (normalized.length < 8) {
        throw new HttpError(400, 'Password must be at least 8 characters');
    }

    return normalized;
}

function normalizeApiKeyInput(apiKey) {
    const normalized = cleanText(apiKey);
    if (!normalized) {
        return '';
    }

    if (normalized.length < 16 || normalized.length > 256) {
        throw new HttpError(400, 'apiKey must be between 16 and 256 characters');
    }

    return normalized;
}

function isUniqueConstraintError(error) {
    return String(error?.message || '').toLowerCase().includes('unique');
}

function safeEqual(left, right) {
    if (!left || !right) {
        return false;
    }

    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
}

function uniqueStrings(values) {
    return [...new Set(values.filter(Boolean))];
}

function base64UrlEncode(value) {
    const buffer = Buffer.isBuffer(value)
        ? value
        : Buffer.from(typeof value === 'string' ? value : JSON.stringify(value));
    return buffer.toString('base64url');
}

function base64UrlDecode(value) {
    return Buffer.from(String(value || ''), 'base64url').toString('utf8');
}

function hashApiKeyWithPepper(apiKeyPepper, apiKey) {
    return createHash('sha256')
        .update(`${apiKeyPepper}:${apiKey}`)
        .digest('hex');
}

function hashApiKey(config, apiKey) {
    return hashApiKeyWithPepper(config.apiKeyPepper, apiKey);
}

function generateApiKey() {
    return `ewk_${randomBytes(24).toString('base64url')}`;
}

function signJwtWithSecret(jwtSecret, payload, expiresAtMs) {
    const header = { alg: 'HS256', typ: 'JWT' };
    const nowSeconds = Math.floor(Date.now() / 1000);
    const fullPayload = {
        ...payload,
        iat: nowSeconds,
        exp: Math.floor(expiresAtMs / 1000)
    };

    const signingInput = `${base64UrlEncode(header)}.${base64UrlEncode(fullPayload)}`;
    const signature = createHmac('sha256', jwtSecret)
        .update(signingInput)
        .digest('base64url');

    return `${signingInput}.${signature}`;
}

function signJwt(config, payload, expiresAtMs) {
    return signJwtWithSecret(config.jwtSecret, payload, expiresAtMs);
}

function verifyJwtWithSecret(jwtSecret, token, expectedTokenType = 'session') {
    const [encodedHeader, encodedPayload, signature] = String(token || '').split('.');
    if (!encodedHeader || !encodedPayload || !signature) {
        throw new HttpError(401, 'Invalid session token');
    }

    const signingInput = `${encodedHeader}.${encodedPayload}`;
    const expectedSignature = createHmac('sha256', jwtSecret)
        .update(signingInput)
        .digest('base64url');

    if (!safeEqual(signature, expectedSignature)) {
        throw new HttpError(401, 'Invalid session token');
    }

    let payload;
    try {
        payload = JSON.parse(base64UrlDecode(encodedPayload));
    } catch {
        throw new HttpError(401, 'Invalid session token');
    }

    if (payload?.token_type !== expectedTokenType) {
        throw new HttpError(401, 'Invalid session token');
    }

    const nowSeconds = Math.floor(Date.now() / 1000);
    if (!Number.isFinite(payload?.exp) || payload.exp <= nowSeconds) {
        throw new HttpError(401, 'Session token expired');
    }

    return payload;
}

function verifyJwt(config, token, expectedTokenType = 'session') {
    const jwtSecrets = uniqueStrings([config.jwtSecret, ...(config.legacyJwtSecrets || [])]);
    let lastError = null;

    for (const jwtSecret of jwtSecrets) {
        try {
            return verifyJwtWithSecret(jwtSecret, token, expectedTokenType);
        } catch (error) {
            if (!(error instanceof HttpError) || error.status !== 401) {
                throw error;
            }
            lastError = error;
        }
    }

    throw lastError || new HttpError(401, 'Invalid session token');
}

function mapUserRow(row, { isAdmin = false, includePasswordState = true } = {}) {
    return {
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        telegramId: row.telegram_id,
        status: row.status,
        hasPassword: includePasswordState ? Boolean(row.password_hash) : undefined,
        hasApiKey: Boolean(row.api_key_hash),
        apiKeyLastFour: row.api_key_last_four || null,
        isAdmin,
        lastSeenAt: row.last_seen_at,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function mapSessionRow(row) {
    return {
        id: row.id,
        userId: row.user_id,
        expiresAt: row.expires_at,
        createdAt: row.created_at,
        lastSeenAt: row.last_seen_at,
        revokedAt: row.revoked_at,
        ipAddress: row.ip_address,
        userAgent: row.user_agent
    };
}

function mapPermissionRow(row) {
    return {
        id: row.id,
        domain: row.domain_name,
        status: row.status,
        user: {
            id: row.user_id,
            username: row.username,
            displayName: row.display_name,
            telegramId: row.telegram_id,
            status: row.user_status
        },
        grantedBy: row.granted_by_user_id ? {
            userId: row.granted_by_user_id,
            username: row.granted_by_username,
            displayName: row.granted_by_display_name
        } : (row.granted_by_label ? { label: row.granted_by_label } : null),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

async function getDomainRecord(db, domainName) {
    const normalizedDomain = normalizeDomain(domainName);
    if (!normalizedDomain) {
        throw new HttpError(400, 'Valid domain is required');
    }

    const row = await db.get(`SELECT * FROM domains WHERE name = ? LIMIT 1`, [normalizedDomain]);
    if (!row) {
        throw new HttpError(404, 'Domain not found');
    }

    return row;
}

async function getUserRecordById(db, userId) {
    const numericUserId = parseNumericId(userId, 'user id');
    const row = await db.get(`SELECT * FROM users WHERE id = ? LIMIT 1`, [numericUserId]);
    if (!row) {
        throw new HttpError(404, 'User not found');
    }

    return row;
}

async function getUserRecordByUsername(db, username) {
    const normalizedUsername = normalizeUsername(username);
    const row = await db.get(
        `SELECT * FROM users WHERE LOWER(username) = ? LIMIT 1`,
        [normalizedUsername]
    );
    if (!row) {
        throw new HttpError(404, 'User not found');
    }

    return row;
}

async function findUserRecordByUsername(db, username) {
    if (!cleanText(username)) {
        return null;
    }

    return db.get(
        `SELECT * FROM users WHERE LOWER(username) = ? LIMIT 1`,
        [normalizeUsername(username)]
    );
}

async function assertUserIdentityAvailable(db, { username, telegramId, excludeUserId = null }) {
    if (username) {
        const existingUsernameRow = await db.get(
            `
                SELECT id
                FROM users
                WHERE LOWER(username) = ?
                  AND (? IS NULL OR id != ?)
                LIMIT 1
            `,
            [username, excludeUserId, excludeUserId]
        );

        if (existingUsernameRow) {
            throw new HttpError(409, 'Username already exists');
        }
    }

    if (telegramId) {
        const existingTelegramRow = await db.get(
            `
                SELECT id
                FROM users
                WHERE telegram_id = ?
                  AND (? IS NULL OR id != ?)
                LIMIT 1
            `,
            [telegramId, excludeUserId, excludeUserId]
        );

        if (existingTelegramRow) {
            throw new HttpError(409, 'telegramId already exists');
        }
    }
}

async function loadAuthUserById(db, userId) {
    return db.get(
        `
            SELECT
                u.*,
                EXISTS(
                    SELECT 1
                    FROM admins a
                    WHERE a.user_id = u.id
                ) AS is_admin
            FROM users u
            WHERE u.id = ?
            LIMIT 1
        `,
        [userId]
    );
}

async function countActiveAdminsTx(db, { excludeUserId = null } = {}) {
    const row = await db.get(
        `
            SELECT COUNT(*) AS total
            FROM admins a
            JOIN users u ON u.id = a.user_id
            WHERE u.status = 'active'
              AND (? IS NULL OR a.user_id != ?)
        `,
        [excludeUserId, excludeUserId]
    );

    return Number(row?.total || 0);
}

function buildAuthContext(row, mode, session = null) {
    return {
        mode,
        userId: row.user_id || row.id,
        username: row.username,
        displayName: row.display_name,
        telegramId: row.telegram_id,
        status: row.status,
        isAdmin: Boolean(row.is_admin),
        sessionId: session?.id || row.session_id || null
    };
}

async function createUserSessionTx(db, config, user, context = {}) {
    const createdAt = nowIso();
    const expiresAt = new Date(Date.now() + config.sessionTtlMs).toISOString();
    const result = await db.run(
        `
            INSERT INTO user_sessions (
                user_id,
                expires_at,
                ip_address,
                user_agent,
                created_at,
                last_seen_at,
                revoked_at
            )
            VALUES (?, ?, ?, ?, ?, ?, NULL)
        `,
        [
            user.id,
            expiresAt,
            cleanNullableText(context.ipAddress),
            cleanNullableText(context.userAgent),
            createdAt,
            createdAt
        ]
    );

    const session = await db.get(`SELECT * FROM user_sessions WHERE id = ? LIMIT 1`, [result.lastID]);
    const sessionToken = signJwt(config, {
        token_type: 'session',
        sub: String(user.id),
        sid: String(session.id)
    }, Date.parse(expiresAt));

    return {
        session,
        sessionToken,
        expiresAt
    };
}

async function updateUserLastSeenTx(db, userId, timestamp = nowIso()) {
    await db.run(
        `
            UPDATE users
            SET last_seen_at = ?,
                updated_at = COALESCE(updated_at, ?)
            WHERE id = ?
        `,
        [timestamp, timestamp, userId]
    );
}

async function listPermissionsForUserId(db, userId, { includeDisabled = true } = {}) {
    const rows = await db.all(
        `
            SELECT
                p.id,
                p.user_id,
                p.status,
                p.granted_by_user_id,
                p.granted_by_label,
                p.created_at,
                p.updated_at,
                d.name AS domain_name,
                u.username,
                u.display_name,
                u.telegram_id,
                u.status AS user_status,
                gu.username AS granted_by_username,
                gu.display_name AS granted_by_display_name
            FROM permissions p
            JOIN domains d ON d.id = p.domain_id
            JOIN users u ON u.id = p.user_id
            LEFT JOIN users gu ON gu.id = p.granted_by_user_id
            WHERE p.user_id = ?
              AND (? = 1 OR p.status = 'active')
            ORDER BY d.name ASC, p.id ASC
        `,
        [userId, includeDisabled ? 1 : 0]
    );

    return rows.map(mapPermissionRow);
}

async function assignApiKeyTx(db, config, userId, providedApiKey = '') {
    const apiKey = normalizeApiKeyInput(providedApiKey) || generateApiKey();
    const apiKeyHash = hashApiKey(config, apiKey);

    try {
        await db.run(
            `
                UPDATE users
                SET api_key_hash = ?,
                    api_key_last_four = ?,
                    updated_at = ?
                WHERE id = ?
            `,
            [apiKeyHash, apiKey.slice(-4), nowIso(), userId]
        );
    } catch (error) {
        if (isUniqueConstraintError(error)) {
            throw new HttpError(409, 'apiKey already exists');
        }

        throw error;
    }

    return apiKey;
}

function getPermissionRequirement(permission) {
    const level = PERMISSION_REQUIREMENTS[permission];
    if (level === undefined) {
        throw new HttpError(500, `Unknown permission requirement: ${permission}`);
    }

    return level;
}

async function getPermissionLevelForScope(db, userId, domainId) {
    const row = await db.get(
        `
            SELECT
                1 AS permission_level
            FROM permissions p
            WHERE p.user_id = ?
              AND p.domain_id = ?
              AND p.status = 'active'
            LIMIT 1
        `,
        [userId, domainId]
    );

    return Number(row?.permission_level || 0);
}

async function resolvePermissionTargetUserTx(db, payload) {
    if (payload.userId !== undefined && payload.userId !== null && payload.userId !== '') {
        return getUserRecordById(db, payload.userId);
    }

    const username = payload.username === undefined ? '' : payload.username;
    if (!cleanText(username)) {
        throw new HttpError(400, 'userId or username is required');
    }

    const normalizedUsername = normalizeUsername(username);
    const existingUser = await findUserRecordByUsername(db, normalizedUsername);
    if (existingUser) {
        return existingUser;
    }

    const now = nowIso();
    const telegramId = normalizeTelegramId(payload.telegramId);
    await assertUserIdentityAvailable(db, {
        username: normalizedUsername,
        telegramId
    });

    const result = await db.run(
        `
            INSERT INTO users (
                username,
                display_name,
                telegram_id,
                password_hash,
                api_key_hash,
                api_key_last_four,
                status,
                created_at,
                updated_at,
                last_seen_at
            )
            VALUES (?, ?, ?, NULL, NULL, NULL, 'active', ?, ?, NULL)
        `,
        [
            normalizedUsername,
            cleanText(payload.displayName),
            telegramId,
            now,
            now
        ]
    );

    return getUserRecordById(db, result.lastID);
}

async function cleanupPermissionDerivedStateTx(db, permission) {
    const permissionOwnerIsAdmin = await db.get(
        `
            SELECT 1
            FROM admins
            WHERE user_id = ?
            LIMIT 1
        `,
        [permission.user_id]
    );

    if (permissionOwnerIsAdmin) {
        return;
    }

    await db.run(
        `
            DELETE FROM email_registers
            WHERE owner_user_id = ?
              AND domain_id = ?
        `,
        [permission.user_id, permission.domain_id]
    );

    const owner = await db.get(
        `
            SELECT telegram_id
            FROM users
            WHERE id = ?
            LIMIT 1
        `,
        [permission.user_id]
    );

    if (cleanText(owner?.telegram_id)) {
        await db.run(
            `
                DELETE FROM telegram_outbox
                WHERE chat_id = ?
                  AND status != 'sent'
                  AND email_id IN (
                      SELECT id
                      FROM emails
                      WHERE domain_id = ?
                  )
            `,
            [owner.telegram_id, permission.domain_id]
        );
    }
}

export async function hashPassword(password) {
    const normalizedPassword = normalizePasswordInput(password);
    const salt = randomBytes(16).toString('base64url');
    const derivedKey = await scrypt(normalizedPassword, salt, 64);
    return `scrypt$${salt}$${Buffer.from(derivedKey).toString('base64url')}`;
}

export async function verifyPassword(password, storedHash) {
    const [algorithm, salt, expectedHash] = String(storedHash || '').split('$');
    if (algorithm !== 'scrypt' || !salt || !expectedHash) {
        return false;
    }

    const derivedKey = await scrypt(String(password || ''), salt, 64);
    const actual = Buffer.from(Buffer.from(derivedKey).toString('base64url'));
    const expected = Buffer.from(expectedHash);
    if (actual.length !== expected.length) {
        return false;
    }

    return timingSafeEqual(actual, expected);
}

export function getAuditActor(auth) {
    if (!auth) {
        return 'system';
    }

    return auth.username || `user:${auth.userId}`;
}

export function hasGlobalPermission(auth) {
    return Boolean(auth?.isAdmin);
}

export function assertSuperAdmin(auth) {
    if (!hasGlobalPermission(auth)) {
        throw new HttpError(403, 'Admin permission required');
    }
}

export async function ensureDomainPermission(config, auth, domainName, permission = 'view') {
    const db = await getDb(config);
    const domain = await getDomainRecord(db, domainName);
    if (hasGlobalPermission(auth)) {
        return {
            domain: domain.name,
            permission,
            scope: 'global'
        };
    }

    const currentLevel = await getPermissionLevelForScope(db, auth?.userId || 0, domain.id);
    if (currentLevel < getPermissionRequirement(permission)) {
        throw new HttpError(403, `Insufficient permission for domain ${domain.name}`);
    }

    return {
        domain: domain.name,
        permission,
        scope: 'domain'
    };
}

export async function ensureMailboxPermission(config, auth, emailAddressOrParts, permission = 'view') {
    const parsedAddress = parseEmailAddress(emailAddressOrParts);

    if (!parsedAddress) {
        throw new HttpError(400, 'Valid email address is required');
    }

    const db = await getDb(config);
    const domain = await getDomainRecord(db, parsedAddress.domain);
    if (hasGlobalPermission(auth)) {
        return {
            domain: domain.name,
            permission,
            scope: 'global'
        };
    }

    const currentLevel = await getPermissionLevelForScope(
        db,
        auth?.userId || 0,
        domain.id
    );

    if (currentLevel < getPermissionRequirement(permission)) {
        throw new HttpError(403, `Insufficient permission for mailbox ${parsedAddress.email}`);
    }

    return {
        domain: domain.name,
        permission,
        scope: 'domain'
    };
}

export async function listAccessibleDomains(config, auth, { domainLevelOnly = false } = {}) {
    if (!auth) {
        return [];
    }

    const db = await getDb(config);
    if (hasGlobalPermission(auth)) {
        const rows = await db.all(`SELECT name FROM domains ORDER BY name ASC`);
        return rows.map(row => row.name);
    }

    const rows = await db.all(
        `
            SELECT DISTINCT d.name
            FROM permissions p
            JOIN domains d ON d.id = p.domain_id
            WHERE p.user_id = ?
              AND p.status = 'active'
            ORDER BY d.name ASC
        `,
        [auth.userId]
    );

    return rows.map(row => row.name);
}

export async function createUser(config, payload) {
    const normalizedUsername = normalizeUsername(payload.username);
    const telegramId = normalizeTelegramId(payload.telegramId);
    const passwordHash = await hashPassword(payload.password);
    const now = nowIso();
    let userId = null;
    let apiKey = '';

    await withTransaction(config, async (db) => {
        await assertUserIdentityAvailable(db, {
            username: normalizedUsername,
            telegramId
        });

        const result = await db.run(
            `
                INSERT INTO users (
                    username,
                    display_name,
                    telegram_id,
                    password_hash,
                    api_key_hash,
                    api_key_last_four,
                    status,
                    created_at,
                    updated_at,
                    last_seen_at
                )
                VALUES (?, ?, ?, ?, NULL, NULL, 'active', ?, ?, NULL)
            `,
            [
                normalizedUsername,
                cleanText(payload.displayName),
                telegramId,
                passwordHash,
                now,
                now
            ]
        );

        userId = result.lastID;
        if (payload.generateApiKey !== false || cleanText(payload.apiKey)) {
            apiKey = await assignApiKeyTx(db, config, userId, payload.apiKey);
        }
    });

    const user = await getUserById(config, userId);
    return {
        user,
        apiKey: apiKey || null
    };
}

export async function listUsers(config, options = {}) {
    const db = await getDb(config);
    const conditions = [];
    const values = [];
    const limit = options.limit || 50;
    const offset = options.offset || 0;
    const keyword = cleanText(options.q).toLowerCase();
    const telegramId = options.telegramId === undefined
        ? null
        : normalizeTelegramId(options.telegramId);

    if (keyword) {
        const pattern = `%${keyword}%`;
        conditions.push(`(LOWER(u.username) LIKE ? OR LOWER(COALESCE(u.display_name, '')) LIKE ? OR COALESCE(u.telegram_id, '') LIKE ?)`);
        values.push(pattern, pattern, pattern);
    }

    if (telegramId) {
        conditions.push(`u.telegram_id = ?`);
        values.push(telegramId);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows, totalRow] = await Promise.all([
        db.all(
        `
            SELECT
                u.*,
                EXISTS(
                    SELECT 1
                    FROM admins a
                    WHERE a.user_id = u.id
                ) AS is_admin,
                COUNT(p.id) AS permission_count
            FROM users u
            LEFT JOIN permissions p
                ON p.user_id = u.id
               AND p.status = 'active'
            ${whereClause}
            GROUP BY u.id
            ORDER BY
                CASE u.status
                    WHEN 'active' THEN 0
                    ELSE 1
                END,
                u.username ASC,
                u.id ASC
            LIMIT ? OFFSET ?
        `,
            [...values, limit, offset]
        ),
        db.get(
            `
                SELECT COUNT(*) AS total
                FROM users u
                ${whereClause}
            `,
            values
        )
    ]);

    return {
        total: totalRow?.total || 0,
        users: rows.map(row => ({
            ...mapUserRow(row, { isAdmin: Boolean(row.is_admin) }),
            permissionCount: row.permission_count || 0
        }))
    };
}

export async function getUserById(config, userId) {
    const db = await getDb(config);
    const row = await db.get(
        `
            SELECT
                u.*,
                EXISTS(
                    SELECT 1
                    FROM admins a
                    WHERE a.user_id = u.id
                ) AS is_admin
            FROM users u
            WHERE u.id = ?
            LIMIT 1
        `,
        [parseNumericId(userId, 'user id')]
    );

    if (!row) {
        throw new HttpError(404, 'User not found');
    }

    const permissions = await listPermissionsForUserId(db, row.id);
    return {
        ...mapUserRow(row, { isAdmin: Boolean(row.is_admin) }),
        permissions
    };
}

export async function updateUser(config, userId, payload) {
    const numericUserId = parseNumericId(userId, 'user id');

    await withTransaction(config, async (db) => {
        const current = await getUserRecordById(db, numericUserId);
        const nextUsername = payload.username === undefined
            ? current.username
            : normalizeUsername(payload.username);
        const nextTelegramId = payload.telegramId === undefined
            ? current.telegram_id
            : normalizeTelegramId(payload.telegramId);

        await assertUserIdentityAvailable(db, {
            username: nextUsername,
            telegramId: nextTelegramId,
            excludeUserId: numericUserId
        });

        const updates = {
            username: nextUsername,
            displayName: payload.displayName === undefined ? current.display_name : cleanText(payload.displayName),
            telegramId: nextTelegramId,
            status: payload.status === undefined ? current.status : normalizeUserStatus(payload.status, current.status),
            passwordHash: payload.password === undefined ? current.password_hash : await hashPassword(payload.password)
        };
        const currentAdminRow = await db.get(
            `
                SELECT 1
                FROM admins
                WHERE user_id = ?
                LIMIT 1
            `,
            [numericUserId]
        );

        if (currentAdminRow && current.status === 'active' && updates.status !== 'active') {
            const remainingActiveAdmins = await countActiveAdminsTx(db, {
                excludeUserId: numericUserId
            });
            if (remainingActiveAdmins <= 0) {
                throw new HttpError(409, 'Cannot disable the last active admin');
            }
        }

        await db.run(
            `
                UPDATE users
                SET username = ?,
                    display_name = ?,
                    telegram_id = ?,
                    status = ?,
                    password_hash = ?,
                    updated_at = ?
                WHERE id = ?
            `,
            [
                updates.username,
                updates.displayName,
                updates.telegramId,
                updates.status,
                updates.passwordHash,
                nowIso(),
                numericUserId
            ]
        );
    });

    return getUserById(config, numericUserId);
}

export async function updateOwnProfile(config, auth, payload) {
    const numericUserId = parseNumericId(auth?.userId, 'user id');
    await withTransaction(config, async (db) => {
        const current = await getUserRecordById(db, numericUserId);
        const nextTelegramId = payload.telegramId === undefined
            ? current.telegram_id
            : normalizeTelegramId(payload.telegramId);

        await assertUserIdentityAvailable(db, {
            username: current.username,
            telegramId: nextTelegramId,
            excludeUserId: numericUserId
        });

        await db.run(
            `
                UPDATE users
                SET display_name = ?,
                    telegram_id = ?,
                    updated_at = ?
                WHERE id = ?
            `,
            [
                payload.displayName === undefined ? current.display_name : cleanText(payload.displayName),
                nextTelegramId,
                nowIso(),
                numericUserId
            ]
        );
    });

    return getCurrentAccountProfile(config, {
        ...auth,
        userId: numericUserId
    });
}

export async function changeOwnPassword(config, auth, payload) {
    const numericUserId = parseNumericId(auth?.userId, 'user id');
    await withTransaction(config, async (db) => {
        const current = await getUserRecordById(db, numericUserId);
        const passwordMatches = await verifyPassword(payload.currentPassword, current.password_hash);
        if (!passwordMatches) {
            throw new HttpError(401, 'Current password is incorrect');
        }

        await db.run(
            `
                UPDATE users
                SET password_hash = ?,
                    updated_at = ?
                WHERE id = ?
            `,
            [await hashPassword(payload.newPassword), nowIso(), numericUserId]
        );
    });

    return { success: true };
}

export async function rotateUserApiKey(config, userId, payload = {}) {
    const numericUserId = parseNumericId(userId, 'user id');
    let apiKey = '';

    await withTransaction(config, async (db) => {
        await getUserRecordById(db, numericUserId);
        apiKey = await assignApiKeyTx(db, config, numericUserId, payload.apiKey);
    });

    return {
        user: await getUserById(config, numericUserId),
        apiKey
    };
}

export async function rotateOwnApiKey(config, auth, payload = {}) {
    return rotateUserApiKey(config, auth?.userId, payload);
}

export async function listAdmins(config, options = {}) {
    const db = await getDb(config);
    const conditions = [];
    const values = [];
    const limit = options.limit || 50;
    const offset = options.offset || 0;
    const keyword = cleanText(options.q).toLowerCase();

    if (keyword) {
        const pattern = `%${keyword}%`;
        conditions.push(`(LOWER(u.username) LIKE ? OR LOWER(COALESCE(u.display_name, '')) LIKE ? OR COALESCE(u.telegram_id, '') LIKE ?)`);
        values.push(pattern, pattern, pattern);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows, totalRow] = await Promise.all([
        db.all(
        `
            SELECT
                a.user_id,
                a.granted_by_user_id,
                a.granted_by_label,
                a.created_at,
                u.username,
                u.display_name,
                u.telegram_id,
                u.status,
                u.api_key_hash,
                u.api_key_last_four,
                u.password_hash,
                u.created_at AS user_created_at,
                u.updated_at,
                u.last_seen_at,
                gu.username AS granted_by_username,
                gu.display_name AS granted_by_display_name
            FROM admins a
            JOIN users u ON u.id = a.user_id
            LEFT JOIN users gu ON gu.id = a.granted_by_user_id
            ${whereClause}
            ORDER BY u.username ASC, u.id ASC
            LIMIT ? OFFSET ?
        `,
            [...values, limit, offset]
        ),
        db.get(
            `
                SELECT COUNT(*) AS total
                FROM admins a
                JOIN users u ON u.id = a.user_id
                ${whereClause}
            `,
            values
        )
    ]);

    return {
        total: totalRow?.total || 0,
        admins: rows.map(row => ({
            ...mapUserRow({
                ...row,
                id: row.user_id,
                created_at: row.user_created_at
            }, {
                isAdmin: true
            }),
            grantedBy: row.granted_by_user_id ? {
                userId: row.granted_by_user_id,
                username: row.granted_by_username,
                displayName: row.granted_by_display_name
            } : (row.granted_by_label ? { label: row.granted_by_label } : null),
            grantedAt: row.created_at
        }))
    };
}

export async function grantAdmin(config, payload, auth) {
    const numericUserId = payload.userId !== undefined && payload.userId !== null && payload.userId !== ''
        ? parseNumericId(payload.userId, 'user id')
        : null;
    const normalizedUsername = numericUserId ? '' : cleanText(payload.username);

    let user = null;
    await withTransaction(config, async (db) => {
        user = numericUserId
            ? await getUserRecordById(db, numericUserId)
            : await getUserRecordByUsername(db, normalizedUsername);

        await db.run(
            `
                INSERT INTO admins (
                    user_id,
                    granted_by_user_id,
                    granted_by_label,
                    created_at
                )
                VALUES (?, ?, ?, ?)
                ON CONFLICT(user_id) DO NOTHING
            `,
            [user.id, auth?.userId || null, getAuditActor(auth), nowIso()]
        );
    });

    return getUserById(config, user.id);
}

export async function revokeAdmin(config, userId) {
    const numericUserId = parseNumericId(userId, 'user id');
    await withTransaction(config, async (db) => {
        const adminRow = await db.get(
            `
                SELECT a.user_id, u.status
                FROM admins a
                JOIN users u ON u.id = a.user_id
                WHERE a.user_id = ?
                LIMIT 1
            `,
            [numericUserId]
        );
        if (!adminRow) {
            return;
        }

        if (adminRow.status === 'active') {
            const remainingActiveAdmins = await countActiveAdminsTx(db, {
                excludeUserId: numericUserId
            });
            if (remainingActiveAdmins <= 0) {
                throw new HttpError(409, 'Cannot remove the last active admin');
            }
        }

        await db.run(`DELETE FROM admins WHERE user_id = ?`, [numericUserId]);
    });

    return { success: true };
}

export async function listPermissions(config, filters = {}, pagination = {}) {
    const db = await getDb(config);
    const conditions = [];
    const values = [];
    const limit = pagination.limit || 50;
    const offset = pagination.offset || 0;

    if (filters.userId) {
        conditions.push(`p.user_id = ?`);
        values.push(parseNumericId(filters.userId, 'user id'));
    }

    if (filters.username) {
        conditions.push(`LOWER(u.username) = ?`);
        values.push(normalizeUsername(filters.username));
    }

    if (filters.domain) {
        const normalizedDomain = normalizeDomain(filters.domain);
        if (!normalizedDomain) {
            throw new HttpError(400, 'Invalid domain filter');
        }

        conditions.push(`d.name = ?`);
        values.push(normalizedDomain);
    }

    if (filters.status) {
        conditions.push(`p.status = ?`);
        values.push(normalizePermissionStatus(filters.status));
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows, totalRow] = await Promise.all([
        db.all(
        `
            SELECT
                p.id,
                p.user_id,
                p.status,
                p.granted_by_user_id,
                p.granted_by_label,
                p.created_at,
                p.updated_at,
                d.name AS domain_name,
                u.username,
                u.display_name,
                u.telegram_id,
                u.status AS user_status,
                gu.username AS granted_by_username,
                gu.display_name AS granted_by_display_name
            FROM permissions p
            JOIN users u ON u.id = p.user_id
            JOIN domains d ON d.id = p.domain_id
            LEFT JOIN users gu ON gu.id = p.granted_by_user_id
            ${whereClause}
            ORDER BY d.name ASC, u.username ASC, p.id ASC
            LIMIT ? OFFSET ?
        `,
            [...values, limit, offset]
        ),
        db.get(
            `
                SELECT COUNT(*) AS total
                FROM permissions p
                JOIN users u ON u.id = p.user_id
                JOIN domains d ON d.id = p.domain_id
                ${whereClause}
            `,
            values
        )
    ]);

    return {
        total: totalRow?.total || 0,
        permissions: rows.map(mapPermissionRow)
    };
}

export async function createPermission(config, payload, auth) {
    const normalizedDomain = normalizeDomain(payload.domain);
    if (!normalizedDomain) {
        throw new HttpError(400, 'Valid domain is required');
    }

    let permissionId = null;
    await withTransaction(config, async (db) => {
        const domain = await getDomainRecord(db, normalizedDomain);
        const user = await resolvePermissionTargetUserTx(db, payload);
        const now = nowIso();
        const current = await db.get(
            `
                SELECT id
                FROM permissions
                WHERE user_id = ?
                  AND domain_id = ?
                LIMIT 1
            `,
            [user.id, domain.id]
        );

        if (current) {
            throw new HttpError(409, 'Permission already exists for this user and domain');
        }

        const result = await db.run(
            `
                INSERT INTO permissions (
                    user_id,
                    domain_id,
                    status,
                    granted_by_user_id,
                    granted_by_label,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, 'active', ?, ?, ?, ?)
            `,
            [
                user.id,
                domain.id,
                auth?.userId || null,
                getAuditActor(auth),
                now,
                now
            ]
        );

        permissionId = result.lastID || null;
    });

    return getPermissionById(config, permissionId);
}

export async function getPermissionById(config, permissionId) {
    const numericPermissionId = parseNumericId(permissionId, 'permission id');
    const db = await getDb(config);
    const row = await db.get(
        `
            SELECT
                p.id,
                p.user_id,
                p.status,
                p.granted_by_user_id,
                p.granted_by_label,
                p.created_at,
                p.updated_at,
                d.name AS domain_name,
                u.username,
                u.display_name,
                u.telegram_id,
                u.status AS user_status,
                gu.username AS granted_by_username,
                gu.display_name AS granted_by_display_name
            FROM permissions p
            JOIN users u ON u.id = p.user_id
            JOIN domains d ON d.id = p.domain_id
            LEFT JOIN users gu ON gu.id = p.granted_by_user_id
            WHERE p.id = ?
            LIMIT 1
        `,
        [numericPermissionId]
    );

    if (!row) {
        throw new HttpError(404, 'Permission not found');
    }

    return mapPermissionRow(row);
}

export async function deletePermission(config, permissionId) {
    const numericPermissionId = parseNumericId(permissionId, 'permission id');

    await withTransaction(config, async (db) => {
        const permission = await db.get(
            `
                SELECT id, user_id, domain_id
                FROM permissions
                WHERE id = ?
                LIMIT 1
            `,
            [numericPermissionId]
        );

        if (!permission) {
            return;
        }

        await db.run(`DELETE FROM permissions WHERE id = ?`, [numericPermissionId]);
        await cleanupPermissionDerivedStateTx(db, permission);
    });

    return { success: true };
}

export async function loginUser(config, payload, context = {}) {
    const normalizedUsername = normalizeUsername(payload.username);
    const db = await getDb(config);
    const user = await db.get(
        `
            SELECT
                u.*,
                EXISTS(
                    SELECT 1
                    FROM admins a
                    WHERE a.user_id = u.id
                ) AS is_admin
            FROM users u
            WHERE LOWER(u.username) = ?
            LIMIT 1
        `,
        [normalizedUsername]
    );

    if (!user || user.status !== 'active' || !user.password_hash) {
        throw new HttpError(401, 'Invalid username or password');
    }

    const passwordMatches = await verifyPassword(payload.password, user.password_hash);
    if (!passwordMatches) {
        throw new HttpError(401, 'Invalid username or password');
    }

    const result = await withTransaction(config, async (transactionDb) => {
        const sessionResult = await createUserSessionTx(transactionDb, config, user, context);
        await updateUserLastSeenTx(transactionDb, user.id, nowIso());
        return sessionResult;
    });

    return {
        sessionToken: result.sessionToken,
        expiresAt: result.expiresAt,
        session: mapSessionRow(result.session),
        account: {
            ...mapUserRow(user, { isAdmin: Boolean(user.is_admin) }),
            permissions: await listPermissionsForUserId(db, user.id)
        }
    };
}

export async function getSessionContext(config, sessionToken) {
    const payload = verifyJwt(config, sessionToken, 'session');
    const numericUserId = parseNumericId(payload.sub, 'user id');
    const numericSessionId = parseNumericId(payload.sid, 'session id');
    const db = await getDb(config);
    const row = await db.get(
        `
            SELECT
                s.*,
                u.id AS user_id,
                u.username,
                u.display_name,
                u.telegram_id,
                u.status,
                EXISTS(
                    SELECT 1
                    FROM admins a
                    WHERE a.user_id = u.id
                ) AS is_admin
            FROM user_sessions s
            JOIN users u ON u.id = s.user_id
            WHERE s.id = ?
              AND s.user_id = ?
              AND s.revoked_at IS NULL
              AND s.expires_at > ?
            LIMIT 1
        `,
        [numericSessionId, numericUserId, nowIso()]
    );

    if (!row || row.status !== 'active') {
        return null;
    }

    return {
        account: buildAuthContext(row, 'session', row),
        session: mapSessionRow(row)
    };
}

export async function getApiKeyContext(config, apiKey) {
    const normalizedApiKey = normalizeApiKeyInput(apiKey);
    if (!normalizedApiKey) {
        return null;
    }

    const apiKeyHashes = uniqueStrings([
        hashApiKey(config, normalizedApiKey),
        ...(config.legacyApiKeyPeppers || []).map(apiKeyPepper => hashApiKeyWithPepper(apiKeyPepper, normalizedApiKey))
    ]);
    if (!apiKeyHashes.length) {
        return null;
    }

    const db = await getDb(config);
    const row = await db.get(
        `
            SELECT
                u.*,
                EXISTS(
                    SELECT 1
                    FROM admins a
                    WHERE a.user_id = u.id
                ) AS is_admin
            FROM users u
            WHERE u.api_key_hash IN (${apiKeyHashes.map(() => '?').join(', ')})
              AND u.status = 'active'
            LIMIT 1
        `,
        apiKeyHashes
    );

    if (!row) {
        return null;
    }

    return buildAuthContext(row, 'api_key');
}

export async function getTelegramAuthContext(config, telegramUserId) {
    const normalizedTelegramId = normalizeTelegramId(telegramUserId);
    if (!normalizedTelegramId) {
        return null;
    }

    const db = await getDb(config);
    const row = await db.get(
        `
            SELECT
                u.*,
                EXISTS(
                    SELECT 1
                    FROM admins a
                    WHERE a.user_id = u.id
                ) AS is_admin
            FROM users u
            WHERE u.telegram_id = ?
            LIMIT 1
        `,
        [normalizedTelegramId]
    );

    if (!row || row.status !== 'active') {
        return null;
    }

    return buildAuthContext(row, 'telegram');
}

export async function touchSession(config, sessionId) {
    const numericSessionId = parseNumericId(sessionId, 'session id');
    const timestamp = nowIso();
    const db = await getDb(config);
    const session = await db.get(`SELECT user_id FROM user_sessions WHERE id = ? LIMIT 1`, [numericSessionId]);
    if (!session) {
        return;
    }

    await db.run(
        `
            UPDATE user_sessions
            SET last_seen_at = ?
            WHERE id = ?
        `,
        [timestamp, numericSessionId]
    );

    await updateUserLastSeenTx(db, session.user_id, timestamp);
}

export async function logoutSession(config, auth) {
    const numericSessionId = parseNumericId(auth?.sessionId, 'session id');
    const db = await getDb(config);
    await db.run(
        `
            UPDATE user_sessions
            SET revoked_at = ?
            WHERE id = ?
              AND revoked_at IS NULL
        `,
        [nowIso(), numericSessionId]
    );

    return { success: true };
}

export async function refreshSession(config, auth) {
    if (auth?.mode !== 'session' || !auth?.sessionId) {
        throw new HttpError(400, 'Active session authentication is required');
    }

    const numericSessionId = parseNumericId(auth.sessionId, 'session id');
    const db = await getDb(config);
    const session = await db.get(
        `
            SELECT *
            FROM user_sessions
            WHERE id = ?
              AND user_id = ?
              AND revoked_at IS NULL
              AND expires_at > ?
            LIMIT 1
        `,
        [numericSessionId, auth.userId, nowIso()]
    );

    if (!session) {
        throw new HttpError(401, 'Session not found or expired');
    }

    const nextExpiresAt = new Date(Date.now() + config.sessionTtlMs).toISOString();
    await db.run(
        `
            UPDATE user_sessions
            SET expires_at = ?,
                last_seen_at = ?
            WHERE id = ?
        `,
        [nextExpiresAt, nowIso(), numericSessionId]
    );

    return {
        sessionToken: signJwt(config, {
            token_type: 'session',
            sub: String(auth.userId),
            sid: String(numericSessionId)
        }, Date.parse(nextExpiresAt)),
        expiresAt: nextExpiresAt
    };
}

export async function revokeExpiredSessions(config) {
    const db = await getDb(config);
    await db.run(
        `
            DELETE FROM user_sessions
            WHERE expires_at <= ?
               OR revoked_at IS NOT NULL
        `,
        [nowIso()]
    );
}

export async function getCurrentAccountProfile(config, auth) {
    const db = await getDb(config);
    const row = await loadAuthUserById(db, parseNumericId(auth?.userId, 'user id'));
    if (!row || row.status !== 'active') {
        throw new HttpError(404, 'User not found');
    }

    const permissions = await listPermissionsForUserId(db, row.id);
    return {
        ...mapUserRow(row, { isAdmin: Boolean(row.is_admin) }),
        permissions
    };
}

export async function ensureBootstrapAdmin(config) {
    if (!config.bootstrapAdminUsername || !config.bootstrapAdminPassword) {
        return;
    }

    const normalizedUsername = normalizeUsername(config.bootstrapAdminUsername);
    await withTransaction(config, async (db) => {
        const existingUser = await findUserRecordByUsername(db, normalizedUsername);
        const timestamp = nowIso();
        let userId = existingUser?.id || null;

        if (existingUser) {
            await assertUserIdentityAvailable(db, {
                username: normalizedUsername,
                excludeUserId: existingUser.id
            });
        } else {
            await assertUserIdentityAvailable(db, {
                username: normalizedUsername
            });

            const passwordHash = await hashPassword(config.bootstrapAdminPassword);
            const result = await db.run(
                `
                    INSERT INTO users (
                        username,
                        display_name,
                        telegram_id,
                        password_hash,
                        api_key_hash,
                        api_key_last_four,
                        status,
                        created_at,
                        updated_at,
                        last_seen_at
                    )
                    VALUES (?, ?, ?, ?, NULL, NULL, 'active', ?, ?, NULL)
                `,
                [
                    normalizedUsername,
                    'Bootstrap Admin',
                    null,
                    passwordHash,
                    timestamp,
                    timestamp
                ]
            );

            userId = result.lastID;
        }

        await db.run(
            `
                INSERT INTO admins (
                    user_id,
                    granted_by_user_id,
                    granted_by_label,
                    created_at
                )
                VALUES (?, NULL, 'bootstrap', ?)
                ON CONFLICT(user_id) DO UPDATE SET
                    granted_by_label = excluded.granted_by_label
            `,
            [userId, timestamp]
        );
    });
}
