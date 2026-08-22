import { getDb, withTransaction } from '../db/index.mjs';
import { buildEmailAddress, normalizeDomain, parseEmailAddress, domainAncestors } from '../utils/email.mjs';
import { ensureMailboxPermission, hasGlobalPermission } from './account-service.mjs';
import { assertRegisteredMailboxPermission } from './email-service.mjs';
import { HttpError } from '../utils/http.mjs';

const GIVEN_NAMES = [
    'an', 'anh', 'bao', 'binh', 'chi', 'cuong', 'danh', 'dat', 'duong', 'duy',
    'giang', 'ha', 'han', 'hanh', 'hieu', 'hoa', 'huong', 'khanh', 'khoa', 'kien',
    'lam', 'lan', 'linh', 'long', 'mai', 'manh', 'minh', 'my', 'nam', 'ngan',
    'nghia', 'ngoc', 'nhat', 'nhung', 'phong', 'phuc', 'phuong', 'quan', 'quang',
    'quoc', 'quynh', 'son', 'tam', 'tan', 'thao', 'thien', 'thu', 'tien', 'trang',
    'trinh', 'truc', 'trung', 'tuan', 'tung', 'uyen', 'van', 'viet', 'vinh', 'vy'
];
const MIDDLE_NAMES = [
    'bao', 'duc', 'gia', 'hai', 'hoai', 'hong', 'huu', 'khanh', 'kim', 'minh',
    'my', 'ngoc', 'nhat', 'phuong', 'quoc', 'thanh', 'thi', 'thu', 'trong', 'van'
];
const FAMILY_NAMES = [
    'nguyen', 'tran', 'le', 'pham', 'hoang', 'phan', 'vu', 'vo', 'dang', 'bui',
    'do', 'ho', 'ngo', 'duong', 'ly', 'truong', 'cao', 'mai', 'luu', 'huynh'
];
const TEAM_ALIASES = [
    'hello', 'contact', 'support', 'booking', 'billing', 'office', 'updates', 'team',
    'care', 'service', 'sales', 'ops', 'marketing', 'hr', 'admin', 'success',
    'growth', 'product', 'launch', 'crm', 'bizdev', 'network', 'platform', 'people'
];
const DEPARTMENT_ALIASES = [
    'helpdesk', 'operations', 'accounts', 'partnerships', 'projects', 'studio',
    'logistics', 'procurement', 'customer', 'founders', 'planning', 'dispatch',
    'compliance', 'finance', 'engineering', 'delivery', 'recruitment', 'research'
];
const CITY_ALIASES = [
    'hanoi', 'saigon', 'danang', 'cantho', 'haiphong', 'nhatrang', 'dalat',
    'hue', 'quynhon', 'vungtau', 'phuquoc', 'bienhoa'
];
const ROLE_ALIASES = [
    'manager', 'coordinator', 'assistant', 'lead', 'specialist', 'executive',
    'advisor', 'consulting', 'representative', 'agent', 'desk', 'reception'
];
const BUSINESS_UNITS = [
    'commerce', 'travel', 'media', 'capital', 'labs', 'ventures',
    'retail', 'mobility', 'cargo', 'academy', 'clinic', 'residence'
];
const MAX_RANDOM_MAIL_ATTEMPTS = 96;

function nowIso() {
    return new Date().toISOString();
}

function parseNumericId(value, label = 'id') {
    const parsed = Number.parseInt(String(value), 10);
    if (!Number.isInteger(parsed) || parsed <= 0) {
        throw new HttpError(400, `Valid ${label} is required`);
    }

    return parsed;
}

function resolveOwnerUserId(auth, filters = {}) {
    if (hasGlobalPermission(auth) && filters.ownerUserId) {
        return parseNumericId(filters.ownerUserId, 'owner user id');
    }

    return parseNumericId(auth?.userId, 'user id');
}

function resolveMutationOwnerUserId(auth, payload = {}) {
    if (hasGlobalPermission(auth) && payload.ownerUserId !== undefined && payload.ownerUserId !== null && payload.ownerUserId !== '') {
        return parseNumericId(payload.ownerUserId, 'owner user id');
    }

    return parseNumericId(auth?.userId, 'user id');
}

function pickRandom(items) {
    return items[Math.floor(Math.random() * items.length)] || '';
}

function uniqueNonEmpty(values) {
    return [...new Set(values.filter(Boolean))];
}

function buildNumericSuffix() {
    const roll = Math.floor(Math.random() * 100);
    if (roll < 38) {
        return '';
    }

    if (roll < 72) {
        return String(10 + Math.floor(Math.random() * 90));
    }

    return String(1984 + Math.floor(Math.random() * 24));
}

function buildShortSuffix() {
    const roll = Math.floor(Math.random() * 100);
    if (roll < 45) {
        return '';
    }

    if (roll < 78) {
        return String(1 + Math.floor(Math.random() * 9));
    }

    return String(10 + Math.floor(Math.random() * 90));
}

function buildLongSuffix() {
    const roll = Math.floor(Math.random() * 100);
    if (roll < 35) {
        return '';
    }

    if (roll < 60) {
        return String(100 + Math.floor(Math.random() * 900));
    }

    if (roll < 82) {
        return String(1980 + Math.floor(Math.random() * 30));
    }

    return `${1 + Math.floor(Math.random() * 12)}${1 + Math.floor(Math.random() * 9)}`;
}

function cleanLocalPartCandidate(value) {
    return String(value || '')
        .toLowerCase()
        .replace(/[^a-z0-9._-]+/g, '')
        .replace(/[._-]{2,}/g, (match) => match[0])
        .replace(/^[._-]+|[._-]+$/g, '');
}

function generateRealisticLocalPart() {
    const firstName = pickRandom(GIVEN_NAMES);
    const middleName = pickRandom(MIDDLE_NAMES);
    const familyName = pickRandom(FAMILY_NAMES);
    const teamAlias = pickRandom(TEAM_ALIASES);
    const departmentAlias = pickRandom(DEPARTMENT_ALIASES);
    const cityAlias = pickRandom(CITY_ALIASES);
    const roleAlias = pickRandom(ROLE_ALIASES);
    const businessUnit = pickRandom(BUSINESS_UNITS);
    const suffix = buildNumericSuffix();
    const shortSuffix = buildShortSuffix();
    const longSuffix = buildLongSuffix();
    const firstInitial = firstName.slice(0, 1);
    const middleInitial = middleName.slice(0, 1);
    const familyInitial = familyName.slice(0, 1);
    const reversedInitials = `${familyInitial}${firstInitial}`;

    const candidates = uniqueNonEmpty([
        `${firstName}.${familyName}${suffix}`,
        `${firstName}${familyName}${suffix}`,
        `${firstName}${suffix}.${familyName}`,
        `${firstInitial}${familyName}${suffix}`,
        `${firstName}.${familyInitial}${suffix}`,
        `${familyName}.${firstName}${suffix}`,
        `${familyName}${firstName}${suffix}`,
        `${firstName}.${middleName}.${familyName}${suffix}`,
        `${firstName}${middleInitial}${familyName}${suffix}`,
        `${firstInitial}.${middleInitial}.${familyName}${suffix}`,
        `${firstName}-${familyName}${suffix}`,
        `${firstName}_${familyName}${suffix}`,
        `${teamAlias}.${familyName}${suffix}`,
        `${teamAlias}.${firstName}${suffix}`,
        `${departmentAlias}.${familyName}${suffix}`,
        `${departmentAlias}.${firstName}${suffix}`,
        `${teamAlias}.${cityAlias}${suffix}`,
        `${departmentAlias}.${cityAlias}${suffix}`,
        `${firstName}.${cityAlias}${suffix}`,
        `${familyName}.${cityAlias}${suffix}`,
        `${teamAlias}.${firstInitial}${familyName}${suffix}`,
        `${departmentAlias}.${firstInitial}${familyName}${suffix}`,
        `${firstName}.${familyName}.${cityAlias}`,
        `${firstName}.${familyName}.${teamAlias}`,
        `${firstName}${suffix}.${teamAlias}`,
        `${familyName}${suffix}.${teamAlias}`,
        `${teamAlias}${suffix}.${familyName}`,
        `${departmentAlias}${suffix}.${familyName}`,
        `${firstName}.${familyName}${suffix || '01'}`,
        `${firstInitial}${middleInitial}${familyName}${suffix}`,
        `${firstName}.${middleInitial}${familyName}${suffix}`,
        `${roleAlias}.${familyName}${shortSuffix}`,
        `${roleAlias}.${firstName}${shortSuffix}`,
        `${roleAlias}.${cityAlias}${shortSuffix}`,
        `${roleAlias}.${businessUnit}${shortSuffix}`,
        `${businessUnit}.${familyName}${shortSuffix}`,
        `${businessUnit}.${firstName}${shortSuffix}`,
        `${businessUnit}.${cityAlias}${shortSuffix}`,
        `${teamAlias}.${businessUnit}${shortSuffix}`,
        `${departmentAlias}.${businessUnit}${shortSuffix}`,
        `${teamAlias}.${roleAlias}${shortSuffix}`,
        `${departmentAlias}.${roleAlias}${shortSuffix}`,
        `${cityAlias}.${familyName}${shortSuffix}`,
        `${cityAlias}.${firstName}${shortSuffix}`,
        `${cityAlias}.${teamAlias}${shortSuffix}`,
        `${cityAlias}.${departmentAlias}${shortSuffix}`,
        `${firstName}.${familyName}${longSuffix}.${cityAlias}`,
        `${firstName}.${familyName}${longSuffix}.${teamAlias}`,
        `${firstName}.${familyName}${longSuffix}.${departmentAlias}`,
        `${familyName}.${firstName}${longSuffix}.${cityAlias}`,
        `${familyName}.${firstName}${longSuffix}.${teamAlias}`,
        `${reversedInitials}.${familyName}${suffix}`,
        `${firstInitial}.${familyName}.${cityAlias}${shortSuffix}`,
        `${firstInitial}.${familyName}.${teamAlias}${shortSuffix}`,
        `${firstInitial}.${familyName}.${departmentAlias}${shortSuffix}`,
        `${firstName}.${familyInitial}.${cityAlias}${shortSuffix}`,
        `${firstName}.${familyInitial}.${teamAlias}${shortSuffix}`,
        `${firstName}.${familyInitial}.${departmentAlias}${shortSuffix}`,
        `${firstName}${shortSuffix}.${familyName}.${cityAlias}`,
        `${firstName}${shortSuffix}.${familyName}.${teamAlias}`,
        `${familyName}${shortSuffix}.${firstName}.${cityAlias}`,
        `${familyName}${shortSuffix}.${firstName}.${teamAlias}`,
        `${teamAlias}.${familyName}.${cityAlias}`,
        `${departmentAlias}.${familyName}.${cityAlias}`,
        `${teamAlias}.${firstName}.${cityAlias}`,
        `${departmentAlias}.${firstName}.${cityAlias}`,
        `${roleAlias}.${firstInitial}${familyName}${shortSuffix}`,
        `${businessUnit}.${firstInitial}${familyName}${shortSuffix}`,
        `${cityAlias}.${firstInitial}${familyName}${shortSuffix}`,
        `${firstName}.${middleName}.${familyName}.${cityAlias}`,
        `${firstName}.${middleName}.${familyName}.${teamAlias}`,
        `${firstInitial}${middleInitial}.${familyName}.${cityAlias}`,
        `${firstInitial}${middleInitial}.${familyName}.${teamAlias}`,
        `${firstName}.${familyName}.${businessUnit}`,
        `${familyName}.${firstName}.${businessUnit}`,
        `${roleAlias}.${businessUnit}.${cityAlias}`,
        `${teamAlias}.${businessUnit}.${cityAlias}`,
        `${departmentAlias}.${businessUnit}.${cityAlias}`,
        `${businessUnit}.${roleAlias}.${cityAlias}${shortSuffix}`,
        `${businessUnit}.${teamAlias}${longSuffix}`,
        `${businessUnit}.${departmentAlias}${longSuffix}`,
        `${businessUnit}.${firstName}${longSuffix}`,
        `${businessUnit}.${familyName}${longSuffix}`
    ])
        .map(cleanLocalPartCandidate)
        .filter(Boolean);

    return pickRandom(candidates);
}

function mapEmailRegisterRow(row) {
    return {
        id: row.id,
        ownerUserId: row.owner_user_id,
        owner: row.owner_username ? {
            id: row.owner_user_id,
            username: row.owner_username,
            displayName: row.owner_display_name
        } : null,
        emailAddress: row.recipient_address,
        localPart: row.local_part,
        domain: row.recipient_domain,
        emailCount: row.email_count || 0,
        latestReceivedAt: row.latest_received_at || null,
        createdAt: row.created_at,
        updatedAt: row.updated_at
    };
}

async function getDomainForRegistrationTx(db, domainName) {
    // Wildcard subdomains: a mailbox under a subdomain registers against the
    // registered ancestor domain — longest match first.
    let row = null;
    for (const ancestor of domainAncestors(domainName)) {
        row = await db.get(
            `
                SELECT id, name, status, inbound_enabled
                FROM domains
                WHERE name = ?
                LIMIT 1
            `,
            [ancestor]
        );
        if (row) {
            break;
        }
    }

    if (!row) {
        throw new HttpError(404, 'Domain not found for email registration');
    }

    if (row.status !== 'active') {
        throw new HttpError(409, 'Domain is disabled for email registration');
    }

    if (!row.inbound_enabled) {
        throw new HttpError(409, 'Inbound is disabled for this domain');
    }

    return row;
}

async function getEmailRegisterRowForActor(db, auth, registrationId) {
    const numericRegistrationId = parseNumericId(registrationId, 'registration id');
    const values = [numericRegistrationId];
    let whereClause = 'er.id = ?';

    if (!hasGlobalPermission(auth)) {
        whereClause += ' AND er.owner_user_id = ?';
        values.push(parseNumericId(auth?.userId, 'user id'));
    }

    const row = await db.get(
        `
            SELECT
                er.*,
                u.username AS owner_username,
                u.display_name AS owner_display_name,
                COUNT(e.id) AS email_count,
                MAX(e.received_at) AS latest_received_at
            FROM email_registers er
            JOIN users u ON u.id = er.owner_user_id
            LEFT JOIN emails e ON e.recipient_address = er.recipient_address
            WHERE ${whereClause}
            GROUP BY er.id, u.username, u.display_name
            LIMIT 1
        `,
        values
    );

    if (!row) {
        throw new HttpError(404, 'Email registration not found');
    }

    return row;
}

async function getEmailRegisterRowByAddressForActor(db, auth, emailAddress) {
    const parsedAddress = parseEmailAddress(emailAddress);
    if (!parsedAddress) {
        throw new HttpError(400, 'Valid email address is required');
    }

    const values = [parsedAddress.email];
    let whereClause = 'er.recipient_address = ?';

    if (!hasGlobalPermission(auth)) {
        whereClause += ' AND er.owner_user_id = ?';
        values.push(parseNumericId(auth?.userId, 'user id'));
    }

    const row = await db.get(
        `
            SELECT
                er.*,
                u.username AS owner_username,
                u.display_name AS owner_display_name,
                COUNT(e.id) AS email_count,
                MAX(e.received_at) AS latest_received_at
            FROM email_registers er
            JOIN users u ON u.id = er.owner_user_id
            LEFT JOIN emails e ON e.recipient_address = er.recipient_address
            WHERE ${whereClause}
            GROUP BY er.id, u.username, u.display_name
            LIMIT 1
        `,
        values
    );

    if (!row) {
        throw new HttpError(404, 'Email registration not found');
    }

    return row;
}

async function isUserAdminTx(db, userId) {
    const row = await db.get(
        `
            SELECT 1
            FROM admins
            WHERE user_id = ?
            LIMIT 1
        `,
        [userId]
    );

    return Boolean(row);
}

async function listCandidateDomainsTx(db, ownerUserId, requestedDomain = '') {
    const normalizedRequestedDomain = requestedDomain
        ? normalizeDomain(requestedDomain)
        : '';
    if (requestedDomain && !normalizedRequestedDomain) {
        throw new HttpError(400, 'Valid domain is required');
    }

    const ownerIsAdmin = await isUserAdminTx(db, ownerUserId);

    if (normalizedRequestedDomain) {
        // Wildcard subdomains: the requested name may be a subdomain of a
        // registered domain — resolve the ancestor (longest match first) for
        // status/permission checks, but generate mailboxes under the
        // requested subdomain itself.
        let domain = null;
        for (const ancestor of domainAncestors(normalizedRequestedDomain)) {
            domain = await db.get(
                `
                    SELECT id, name, status, inbound_enabled
                    FROM domains
                    WHERE name = ?
                    LIMIT 1
                `,
                [ancestor]
            );
            if (domain) {
                break;
            }
        }

        if (!domain) {
            throw new HttpError(404, 'Domain not found for email registration');
        }

        if (domain.status !== 'active') {
            throw new HttpError(409, 'Domain is disabled for email registration');
        }

        if (!domain.inbound_enabled) {
            throw new HttpError(409, 'Inbound is disabled for this domain');
        }

        if (!ownerIsAdmin) {
            const permission = await db.get(
                `
                    SELECT 1
                    FROM permissions
                    WHERE user_id = ?
                      AND domain_id = ?
                      AND status = 'active'
                    LIMIT 1
                `,
                [ownerUserId, domain.id]
            );

            if (!permission) {
                throw new HttpError(403, 'Domain is not available for this user');
            }
        }

        return [normalizedRequestedDomain];
    }

    const rows = ownerIsAdmin
        ? await db.all(
            `
                SELECT name
                FROM domains
                WHERE status = 'active'
                  AND inbound_enabled = 1
                ORDER BY is_default DESC, name ASC
            `
        )
        : await db.all(
            `
                SELECT DISTINCT d.name
                FROM permissions p
                JOIN domains d ON d.id = p.domain_id
                WHERE p.user_id = ?
                  AND p.status = 'active'
                  AND d.status = 'active'
                  AND d.inbound_enabled = 1
                ORDER BY d.is_default DESC, d.name ASC
            `,
            [ownerUserId]
        );

    const domains = rows.map(row => row.name).filter(Boolean);
    if (!domains.length) {
        throw new HttpError(409, 'No active inbound-enabled domain is available for automatic mailbox generation');
    }

    return domains;
}

async function emailAddressExistsTx(db, emailAddress) {
    const row = await db.get(
        `
            SELECT 1
            FROM email_registers
            WHERE recipient_address = ?
            UNION
            SELECT 1
            FROM emails
            WHERE recipient_address = ?
            LIMIT 1
        `,
        [emailAddress, emailAddress]
    );

    return Boolean(row);
}

export async function listEmailRegisters(config, auth, filters = {}, pagination = {}) {
    const ownerUserId = resolveOwnerUserId(auth, filters);
    const db = await getDb(config);
    const limit = pagination.limit || 50;
    const offset = pagination.offset || 0;
    const search = typeof filters.search === 'string' ? filters.search.trim().slice(0, 200) : '';
    const searchClause = search
        ? "AND er.recipient_address LIKE '%' || ? || '%' ESCAPE '\\'"
        : '';
    const searchParams = search
        ? [search.replace(/[\\%_]/g, (char) => `\\${char}`)]
        : [];
    const [rows, totalRow] = await Promise.all([
        db.all(
        `
            SELECT
                er.*,
                u.username AS owner_username,
                u.display_name AS owner_display_name,
                COUNT(e.id) AS email_count,
                MAX(e.received_at) AS latest_received_at
            FROM email_registers er
            JOIN users u ON u.id = er.owner_user_id
            LEFT JOIN emails e ON e.recipient_address = er.recipient_address
            WHERE er.owner_user_id = ?
            ${searchClause}
            GROUP BY er.id, u.username, u.display_name
            ORDER BY er.updated_at DESC, er.id DESC
            LIMIT ? OFFSET ?
        `,
            [ownerUserId, ...searchParams, limit, offset]
        ),
        db.get(
            `
                SELECT COUNT(*) AS total
                FROM email_registers er
                WHERE er.owner_user_id = ?
                ${searchClause}
            `,
            [ownerUserId, ...searchParams]
        )
    ]);

    return {
        total: totalRow?.total || 0,
        registrations: rows.map(mapEmailRegisterRow)
    };
}

export async function createEmailRegister(config, auth, payload) {
    const parsedAddress = parseEmailAddress(payload.emailAddress);
    if (!parsedAddress) {
        throw new HttpError(400, 'Valid email address is required');
    }

    const ownerUserId = resolveMutationOwnerUserId(auth, payload);
    const db = await getDb(config);
    await getDomainForRegistrationTx(db, parsedAddress.domain);
    const ownerIsAdmin = await isUserAdminTx(db, ownerUserId);

    if (ownerUserId === parseNumericId(auth?.userId, 'user id')) {
        await ensureMailboxPermission(config, auth, parsedAddress.email, 'view');
    } else if (ownerIsAdmin && hasGlobalPermission(auth)) {
        // A global admin may pre-register mailboxes for another admin on any existing active domain.
    } else {
        await assertRegisteredMailboxPermission(config, auth, parsedAddress.email, 'view', {
            userId: ownerUserId,
            requireRegistration: false
        });
    }

    let registrationId = null;

    await withTransaction(config, async (db) => {
        const existing = await db.get(
            `
                SELECT id, owner_user_id
                FROM email_registers
                WHERE recipient_address = ?
                LIMIT 1
            `,
            [parsedAddress.email]
        );

        if (existing) {
            if (existing.owner_user_id === ownerUserId) {
                await db.run(
                    `
                        UPDATE email_registers
                        SET updated_at = ?
                        WHERE id = ?
                    `,
                    [nowIso(), existing.id]
                );
                registrationId = existing.id;
                return;
            }

            throw new HttpError(409, 'Email address is already registered by another user');
        }

        const domain = await getDomainForRegistrationTx(db, parsedAddress.domain);

        const timestamp = nowIso();
        const result = await db.run(
            `
                INSERT INTO email_registers (
                    owner_user_id,
                    domain_id,
                    recipient_address,
                    local_part,
                    recipient_domain,
                    created_at,
                    updated_at
                )
                VALUES (?, ?, ?, ?, ?, ?, ?)
            `,
            [
                ownerUserId,
                domain.id,
                parsedAddress.email,
                parsedAddress.localPart,
                parsedAddress.domain,
                timestamp,
                timestamp
            ]
        );

        registrationId = result.lastID;
    });

    const row = await getEmailRegisterRowForActor(db, auth, registrationId);
    return mapEmailRegisterRow(row);
}

export async function createRandomEmailRegister(config, auth, options = {}) {
    const ownerUserId = resolveMutationOwnerUserId(auth, options);
    const db = await getDb(config);
    const candidateDomains = await listCandidateDomainsTx(db, ownerUserId, options.domain ? String(options.domain) : '');
    const payloadBase = ownerUserId === parseNumericId(auth?.userId, 'user id')
        ? {}
        : { ownerUserId };

    for (let attempt = 0; attempt < MAX_RANDOM_MAIL_ATTEMPTS; attempt += 1) {
        const domain = candidateDomains[attempt % candidateDomains.length];
        const emailAddress = buildEmailAddress(generateRealisticLocalPart(), domain);
        if (!emailAddress || await emailAddressExistsTx(db, emailAddress)) {
            continue;
        }

        try {
            const registration = await createEmailRegister(config, auth, {
                ...payloadBase,
                emailAddress
            });
            return registration;
        } catch (error) {
            if (error instanceof HttpError && error.status === 409) {
                continue;
            }

            throw error;
        }
    }

    throw new HttpError(409, 'Could not generate a new mailbox automatically');
}

export async function listAvailableRegistrationDomains(config, auth, options = {}) {
    const ownerUserId = resolveMutationOwnerUserId(auth, options);
    const db = await getDb(config);
    return listCandidateDomainsTx(db, ownerUserId, options.domain ? String(options.domain) : '');
}

export async function getEmailRegisterById(config, auth, registrationId) {
    const db = await getDb(config);
    const row = await getEmailRegisterRowForActor(db, auth, registrationId);
    return mapEmailRegisterRow(row);
}

export async function getEmailRegisterByAddress(config, auth, emailAddress) {
    const db = await getDb(config);
    const row = await getEmailRegisterRowByAddressForActor(db, auth, emailAddress);
    return mapEmailRegisterRow(row);
}

export async function deleteEmailRegister(config, auth, registrationId) {
    await withTransaction(config, async (db) => {
        const registration = await getEmailRegisterRowForActor(db, auth, registrationId);
        const owner = await db.get(
            `
                SELECT telegram_id
                FROM users
                WHERE id = ?
                LIMIT 1
            `,
            [registration.owner_user_id]
        );
        await db.run(`DELETE FROM email_registers WHERE id = ?`, [registration.id]);
        if (String(owner?.telegram_id || '').trim()) {
            await db.run(
                `
                    DELETE FROM telegram_outbox
                    WHERE chat_id = ?
                      AND status != 'sent'
                      AND email_id IN (
                          SELECT id
                          FROM emails
                          WHERE recipient_address = ?
                      )
                `,
                [owner.telegram_id, registration.recipient_address]
            );
        }
    });

    return { success: true };
}
