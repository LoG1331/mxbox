import { getDb, withTransaction } from '../db/index.mjs';
import { getAuditActor } from './account-service.mjs';
import { normalizeDomain, parseEmailAddress } from '../utils/email.mjs';
import { HttpError } from '../utils/http.mjs';

const BLOCK_STATUS = new Set(['active', 'disabled']);
const BLOCK_PATTERN_TYPES = new Set(['email', 'domain']);
const MAX_SENDER_DOMAIN_LABELS = 10;

function nowIso() {
    return new Date().toISOString();
}

function cleanText(value) {
    return String(value ?? '').trim();
}

function parseNumericId(value, label = 'id') {
    const numericValue = Number.parseInt(String(value), 10);
    if (!Number.isInteger(numericValue) || numericValue <= 0) {
        throw new HttpError(400, `Valid ${label} is required`);
    }

    return numericValue;
}

function normalizeBlockStatus(value, fallback = 'active') {
    const normalized = cleanText(value).toLowerCase();
    if (!normalized) {
        return fallback;
    }

    if (!BLOCK_STATUS.has(normalized)) {
        throw new HttpError(400, `Unsupported blocked sender status: ${value}`);
    }

    return normalized;
}

function normalizePatternType(value) {
    const normalized = cleanText(value).toLowerCase();
    if (!normalized) {
        return '';
    }

    if (!BLOCK_PATTERN_TYPES.has(normalized)) {
        throw new HttpError(400, `Unsupported blocked sender pattern type: ${value}`);
    }

    return normalized;
}

/**
 * Accepts `user@example.com`, `example.com` or `@example.com` and figures out
 * which of the two pattern types the caller meant when they did not say.
 */
export function normalizeBlockPattern(rawPattern, requestedType = '') {
    const patternType = normalizePatternType(requestedType);
    const trimmed = cleanText(rawPattern).toLowerCase().replace(/^@/, '');
    if (!trimmed) {
        throw new HttpError(400, 'Blocked sender pattern is required');
    }

    if (patternType === 'domain' || (!patternType && !trimmed.includes('@'))) {
        const domain = normalizeDomain(trimmed);
        if (!domain) {
            throw new HttpError(400, 'Valid sender domain is required');
        }

        return {
            patternType: 'domain',
            pattern: domain
        };
    }

    const parsedAddress = parseEmailAddress(trimmed);
    if (!parsedAddress) {
        throw new HttpError(400, 'Valid sender email address is required');
    }

    return {
        patternType: 'email',
        pattern: parsedAddress.email
    };
}

/**
 * Every domain a blocked `domain` pattern could match for this sender, so the
 * lookup stays a single indexed IN query instead of a LIKE scan.
 * `a@mail.corp.example.com` -> ['mail.corp.example.com', 'corp.example.com', 'example.com'].
 */
function buildSenderDomainCandidates(senderDomain) {
    const labels = senderDomain.split('.');
    const candidates = [];

    for (let index = 0; index < labels.length - 1 && index < MAX_SENDER_DOMAIN_LABELS; index += 1) {
        candidates.push(labels.slice(index).join('.'));
    }

    return candidates;
}

function mapBlockedSenderRow(row) {
    return {
        id: row.id,
        patternType: row.pattern_type,
        pattern: row.pattern,
        scope: row.domain_name ? 'domain' : 'global',
        domain: row.domain_name || null,
        reason: row.reason,
        status: row.status,
        matchCount: row.match_count || 0,
        lastMatchedAt: row.last_matched_at,
        createdBy: row.created_by_user_id ? {
            userId: row.created_by_user_id,
            username: row.created_by_username,
            displayName: row.created_by_display_name
        } : (row.created_by_label ? { label: row.created_by_label } : null),
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

function blockedSenderSelect() {
    return `
        SELECT
            b.id,
            b.pattern_type,
            b.pattern,
            b.reason,
            b.status,
            b.match_count,
            b.last_matched_at,
            b.created_by_user_id,
            b.created_by_label,
            b.created_at,
            b.updated_at,
            d.name AS domain_name,
            cu.username AS created_by_username,
            cu.display_name AS created_by_display_name
        FROM blocked_senders b
        LEFT JOIN domains d ON d.id = b.domain_id
        LEFT JOIN users cu ON cu.id = b.created_by_user_id
    `;
}

async function resolveScopeDomainId(db, domainName) {
    if (domainName === undefined || domainName === null || cleanText(domainName) === '') {
        return null;
    }

    const normalizedDomain = normalizeDomain(domainName);
    if (!normalizedDomain) {
        throw new HttpError(400, 'Valid domain is required');
    }

    const row = await db.get(`SELECT id FROM domains WHERE name = ? LIMIT 1`, [normalizedDomain]);
    if (!row) {
        throw new HttpError(404, 'Domain not found');
    }

    return row.id;
}

export async function listBlockedSenders(config, filters = {}, pagination = {}) {
    const db = await getDb(config);
    const conditions = [];
    const values = [];
    const limit = pagination.limit || 50;
    const offset = pagination.offset || 0;

    if (filters.patternType) {
        conditions.push(`b.pattern_type = ?`);
        values.push(normalizePatternType(filters.patternType));
    }

    if (filters.status) {
        conditions.push(`b.status = ?`);
        values.push(normalizeBlockStatus(filters.status));
    }

    if (filters.domain) {
        const normalizedDomain = normalizeDomain(filters.domain);
        if (!normalizedDomain) {
            throw new HttpError(400, 'Invalid domain filter');
        }

        conditions.push(`d.name = ?`);
        values.push(normalizedDomain);
    }

    if (filters.scope === 'global') {
        conditions.push(`b.domain_id IS NULL`);
    } else if (filters.scope === 'domain') {
        conditions.push(`b.domain_id IS NOT NULL`);
    } else if (filters.scope) {
        throw new HttpError(400, 'Invalid scope filter');
    }

    const keyword = cleanText(filters.q).toLowerCase();
    if (keyword) {
        const pattern = `%${keyword.replace(/[\\%_]/g, '\\$&')}%`;
        conditions.push(`(b.pattern LIKE ? ESCAPE '\\' OR LOWER(b.reason) LIKE ? ESCAPE '\\')`);
        values.push(pattern, pattern);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows, totalRow] = await Promise.all([
        db.all(
            `
                ${blockedSenderSelect()}
                ${whereClause}
                ORDER BY b.updated_at DESC, b.id DESC
                LIMIT ? OFFSET ?
            `,
            [...values, limit, offset]
        ),
        db.get(
            `
                SELECT COUNT(*) AS total
                FROM blocked_senders b
                LEFT JOIN domains d ON d.id = b.domain_id
                ${whereClause}
            `,
            values
        )
    ]);

    return {
        total: totalRow?.total || 0,
        blockedSenders: rows.map(mapBlockedSenderRow)
    };
}

export async function getBlockedSenderById(config, blockedSenderId) {
    const numericId = parseNumericId(blockedSenderId, 'blocked sender id');
    const db = await getDb(config);
    const row = await db.get(
        `
            ${blockedSenderSelect()}
            WHERE b.id = ?
            LIMIT 1
        `,
        [numericId]
    );

    if (!row) {
        throw new HttpError(404, 'Blocked sender not found');
    }

    return mapBlockedSenderRow(row);
}

export async function createBlockedSender(config, payload, auth) {
    const { patternType, pattern } = normalizeBlockPattern(payload.pattern, payload.patternType);
    const reason = cleanText(payload.reason);
    const status = normalizeBlockStatus(payload.status, 'active');
    const timestamp = nowIso();
    let blockedSenderId = null;

    await withTransaction(config, async (db) => {
        const domainId = await resolveScopeDomainId(db, payload.domain);
        const current = await db.get(
            `
                SELECT id
                FROM blocked_senders
                WHERE pattern_type = ?
                  AND pattern = ?
                  AND COALESCE(domain_id, 0) = ?
                LIMIT 1
            `,
            [patternType, pattern, domainId || 0]
        );

        if (current) {
            throw new HttpError(409, 'This sender is already blocked for the requested scope');
        }

        const result = await db.run(
            `
                INSERT INTO blocked_senders (
                    pattern_type,
                    pattern,
                    domain_id,
                    reason,
                    status,
                    match_count,
                    last_matched_at,
                    created_by_user_id,
                    created_by_label,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, 0, NULL, ?, ?, ?, ?)
            `,
            [
                patternType,
                pattern,
                domainId,
                reason,
                status,
                auth?.userId || null,
                getAuditActor(auth),
                timestamp,
                timestamp
            ]
        );

        blockedSenderId = result.lastID || null;
    });

    return getBlockedSenderById(config, blockedSenderId);
}

export async function updateBlockedSender(config, blockedSenderId, payload) {
    const numericId = parseNumericId(blockedSenderId, 'blocked sender id');

    await withTransaction(config, async (db) => {
        const current = await db.get(
            `
                SELECT *
                FROM blocked_senders
                WHERE id = ?
                LIMIT 1
            `,
            [numericId]
        );

        if (!current) {
            throw new HttpError(404, 'Blocked sender not found');
        }

        const next = payload.pattern === undefined && payload.patternType === undefined
            ? {
                patternType: current.pattern_type,
                pattern: current.pattern
            }
            : normalizeBlockPattern(
                payload.pattern === undefined ? current.pattern : payload.pattern,
                payload.patternType === undefined ? current.pattern_type : payload.patternType
            );
        const domainId = payload.domain === undefined
            ? current.domain_id
            : await resolveScopeDomainId(db, payload.domain);
        const duplicate = await db.get(
            `
                SELECT id
                FROM blocked_senders
                WHERE pattern_type = ?
                  AND pattern = ?
                  AND COALESCE(domain_id, 0) = ?
                  AND id != ?
                LIMIT 1
            `,
            [next.patternType, next.pattern, domainId || 0, numericId]
        );

        if (duplicate) {
            throw new HttpError(409, 'This sender is already blocked for the requested scope');
        }

        await db.run(
            `
                UPDATE blocked_senders
                SET pattern_type = ?,
                    pattern = ?,
                    domain_id = ?,
                    reason = ?,
                    status = ?,
                    updated_at = ?
                WHERE id = ?
            `,
            [
                next.patternType,
                next.pattern,
                domainId,
                payload.reason === undefined ? current.reason : cleanText(payload.reason),
                payload.status === undefined ? current.status : normalizeBlockStatus(payload.status, current.status),
                nowIso(),
                numericId
            ]
        );
    });

    return getBlockedSenderById(config, numericId);
}

export async function deleteBlockedSender(config, blockedSenderId) {
    const numericId = parseNumericId(blockedSenderId, 'blocked sender id');
    const db = await getDb(config);
    await db.run(`DELETE FROM blocked_senders WHERE id = ?`, [numericId]);

    return { success: true };
}

/**
 * Resolves the blocking rule for an inbound sender, most specific first:
 * recipient-domain-scoped rules beat global ones, exact addresses beat domains.
 * Returns null when the sender may pass.
 */
export async function findBlockingRuleTx(db, senderAddress, recipientDomainId = null) {
    const parsedSender = parseEmailAddress(senderAddress);
    if (!parsedSender) {
        return null;
    }

    const domainCandidates = buildSenderDomainCandidates(parsedSender.domain);
    const domainPlaceholders = domainCandidates.map(() => '?').join(', ');
    const row = await db.get(
        `
            SELECT
                b.id,
                b.pattern_type,
                b.pattern,
                b.domain_id,
                b.reason
            FROM blocked_senders b
            WHERE b.status = 'active'
              AND (b.domain_id IS NULL OR b.domain_id = ?)
              AND (
                  (b.pattern_type = 'email' AND b.pattern = ?)
                  ${domainCandidates.length ? `OR (b.pattern_type = 'domain' AND b.pattern IN (${domainPlaceholders}))` : ''}
              )
            ORDER BY
                CASE WHEN b.domain_id IS NULL THEN 1 ELSE 0 END ASC,
                CASE WHEN b.pattern_type = 'email' THEN 0 ELSE 1 END ASC,
                LENGTH(b.pattern) DESC,
                b.id ASC
            LIMIT 1
        `,
        [recipientDomainId || 0, parsedSender.email, ...domainCandidates]
    );

    if (!row) {
        return null;
    }

    return {
        id: row.id,
        patternType: row.pattern_type,
        pattern: row.pattern,
        scope: row.domain_id ? 'domain' : 'global',
        reason: row.reason || ''
    };
}

export async function recordBlockedSenderHitTx(db, blockedSenderId, timestamp = nowIso()) {
    await db.run(
        `
            UPDATE blocked_senders
            SET match_count = match_count + 1,
                last_matched_at = ?
            WHERE id = ?
        `,
        [timestamp, blockedSenderId]
    );
}
