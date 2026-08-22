import { getDb, withTransaction } from '../db/index.mjs';
import { normalizeDomain } from '../utils/email.mjs';
import { HttpError } from '../utils/http.mjs';

function nowIso() {
    return new Date().toISOString();
}

function cleanText(value) {
    return String(value ?? '').trim();
}

function parseAllowedSubdomains(value) {
    if (value === undefined || value === null) {
        return null;
    }

    try {
        const list = JSON.parse(value);
        return Array.isArray(list) ? list : null;
    } catch {
        return null;
    }
}

function mapDomainRow(row) {
    return {
        id: row.id,
        domain: row.name,
        description: row.description,
        status: row.status,
        inboundEnabled: Boolean(row.inbound_enabled),
        isDefault: Boolean(row.is_default),
        allowedSubdomains: parseAllowedSubdomains(row.allowed_subdomains),
        counts: {
            permissionCount: row.permission_count || 0,
            emails: row.email_count || 0
        },
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

export async function listDomains(config, options = {}) {
    const db = await getDb(config);
    const conditions = [];
    const values = [];
    const limit = options.limit || 50;
    const offset = options.offset || 0;

    if (Array.isArray(options.allowedDomains)) {
        const normalizedDomains = options.allowedDomains
            .map(domain => normalizeDomain(domain))
            .filter(Boolean);

        if (!normalizedDomains.length) {
            return {
                total: 0,
                domains: []
            };
        }

        conditions.push(`d.name IN (${normalizedDomains.map(() => '?').join(', ')})`);
        values.push(...normalizedDomains);
    }

    const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
    const [rows, totalRow] = await Promise.all([
        db.all(
        `
            SELECT
                d.*,
                COALESCE(p.permission_count, 0) AS permission_count,
                COALESCE(e.email_count, 0) AS email_count
            FROM domains d
            LEFT JOIN (
                SELECT domain_id, COUNT(*) AS permission_count
                FROM permissions
                WHERE status = 'active'
                GROUP BY domain_id
            ) p ON p.domain_id = d.id
            LEFT JOIN (
                SELECT domain_id, COUNT(*) AS email_count
                FROM emails
                GROUP BY domain_id
            ) e ON e.domain_id = d.id
            ${whereClause}
            ORDER BY d.is_default DESC, d.name ASC
            LIMIT ? OFFSET ?
        `,
            [...values, limit, offset]
        ),
        db.get(
            `
                SELECT COUNT(*) AS total
                FROM domains d
                ${whereClause}
            `,
            values
        )
    ]);

    return {
        total: totalRow?.total || 0,
        domains: rows.map(mapDomainRow)
    };
}

export async function getDomain(config, domainName) {
    const normalizedDomain = normalizeDomain(domainName);
    if (!normalizedDomain) {
        throw new HttpError(400, 'Valid domain is required');
    }

    const db = await getDb(config);
    const row = await db.get(
        `
            SELECT
                d.*,
                COALESCE(p.permission_count, 0) AS permission_count,
                COALESCE(e.email_count, 0) AS email_count
            FROM domains d
            LEFT JOIN (
                SELECT domain_id, COUNT(*) AS permission_count
                FROM permissions
                WHERE status = 'active'
                GROUP BY domain_id
            ) p ON p.domain_id = d.id
            LEFT JOIN (
                SELECT domain_id, COUNT(*) AS email_count
                FROM emails
                GROUP BY domain_id
            ) e ON e.domain_id = d.id
            WHERE d.name = ?
            LIMIT 1
        `,
        [normalizedDomain]
    );

    if (!row) {
        throw new HttpError(404, 'Domain not found');
    }

    return mapDomainRow(row);
}

export async function createDomain(config, payload) {
    const domain = normalizeDomain(payload.domain);
    if (!domain) {
        throw new HttpError(400, 'Valid domain is required');
    }

    const description = cleanText(payload.description);
    const isDefault = payload.isDefault === true;
    const timestamp = nowIso();

    await withTransaction(config, async (db) => {
        const current = await db.get(
            `
                SELECT id
                FROM domains
                WHERE name = ?
                LIMIT 1
            `,
            [domain]
        );

        if (current) {
            throw new HttpError(409, 'Domain already exists');
        }

        if (isDefault) {
            await db.run(
                `
                    UPDATE domains
                    SET is_default = 0,
                        updated_at = ?
                    WHERE is_default = 1
                `,
                [timestamp]
            );
        }

        await db.run(
            `
                INSERT INTO domains (
                    name,
                    description,
                    status,
                    inbound_enabled,
                    is_default,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, 'active', 1, ?, ?, ?)
            `,
            [
                domain,
                description,
                isDefault ? 1 : 0,
                timestamp,
                timestamp
            ]
        );
    });

    return getDomain(config, domain);
}

// Normalize the allowed-subdomains list for storage. null = wildcard (accept
// every subdomain); an array of labels restricts the domain to those
// subdomains (each entry also covers its own subdomains). Entries are
// hostname-label chains ('crm', 'x.crm'), lowercased and deduped.
const SUBDOMAIN_ENTRY_RE = /^(?!-)[a-z0-9-]{1,63}(?<!-)(\.(?!-)[a-z0-9-]{1,63}(?<!-))*$/i;

export function normalizeAllowedSubdomains(value) {
    if (value === undefined || value === null) {
        return null;
    }

    if (!Array.isArray(value)) {
        throw new HttpError(400, 'allowedSubdomains must be an array of labels');
    }

    const labels = [...new Set(
        value
            .map(item => String(item || '').trim().toLowerCase())
            .filter(Boolean)
    )];

    for (const label of labels) {
        if (!SUBDOMAIN_ENTRY_RE.test(label)) {
            throw new HttpError(400, `Invalid subdomain label: ${label}`);
        }
    }

    return labels;
}

export async function updateDomain(config, domainName, payload) {
    const normalizedDomain = normalizeDomain(domainName);
    if (!normalizedDomain) {
        throw new HttpError(400, 'Valid domain is required');
    }

    const timestamp = nowIso();

    await withTransaction(config, async (db) => {
        const domain = await getDomainRecord(db, normalizedDomain);

        if (payload.allowedSubdomains !== undefined) {
            const list = normalizeAllowedSubdomains(payload.allowedSubdomains);
            await db.run(
                `
                    UPDATE domains
                    SET allowed_subdomains = ?,
                        updated_at = ?
                    WHERE id = ?
                `,
                [list === null ? null : JSON.stringify(list), timestamp, domain.id]
            );
        }
    });

    return getDomain(config, normalizedDomain);
}

export async function deleteDomain(config, domainName) {
    const normalizedDomain = normalizeDomain(domainName);
    if (!normalizedDomain) {
        throw new HttpError(400, 'Valid domain is required');
    }

    await withTransaction(config, async (db) => {
        const domain = await getDomainRecord(db, normalizedDomain);
        await db.run(`DELETE FROM domains WHERE id = ?`, [domain.id]);
    });

    return { success: true };
}
