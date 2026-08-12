import { mkdir, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

let dbPromise;
let transactionQueue = Promise.resolve();
let pruneState = {
    lastRunAt: 0,
    running: false
};

async function rebuildPermissionsTableIfNeeded(db) {
    const columns = await db.all(`PRAGMA table_info(permissions)`);
    if (!columns.length) {
        return;
    }

    const columnNames = new Set(columns.map((column) => column.name));
    const legacySchema = columnNames.has('local_part') || columnNames.has('role');

    if (!legacySchema) {
        return;
    }

    await db.exec(`
        DROP INDEX IF EXISTS idx_permissions_unique_domain_scope;
        DROP INDEX IF EXISTS idx_permissions_unique_mailbox_scope;
        DROP INDEX IF EXISTS idx_permissions_user_scope;
        DROP INDEX IF EXISTS idx_permissions_domain_scope;
        DROP TABLE IF EXISTS permissions;
    `);

    await db.exec(`
        CREATE TABLE permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            domain_id INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
            granted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            granted_by_label TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(user_id, domain_id)
        );
    `);
}

async function initializeDatabase(config) {
    await mkdir(path.dirname(config.sqlitePath), { recursive: true });

    const db = await open({
        filename: config.sqlitePath,
        driver: sqlite3.Database
    });

    await db.exec(`
        PRAGMA journal_mode = WAL;
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS domains (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            name TEXT NOT NULL UNIQUE,
            description TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
            inbound_enabled INTEGER NOT NULL DEFAULT 1,
            is_default INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT NOT NULL,
            display_name TEXT NOT NULL DEFAULT '',
            telegram_id TEXT,
            password_hash TEXT,
            api_key_hash TEXT,
            api_key_last_four TEXT,
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            last_seen_at TEXT
        );

        CREATE TABLE IF NOT EXISTS permissions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            domain_id INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
            granted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            granted_by_label TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(user_id, domain_id)
        );

        CREATE TABLE IF NOT EXISTS admins (
            user_id INTEGER PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
            granted_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            granted_by_label TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS user_sessions (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            expires_at TEXT NOT NULL,
            ip_address TEXT,
            user_agent TEXT,
            created_at TEXT NOT NULL,
            last_seen_at TEXT NOT NULL,
            revoked_at TEXT
        );

        CREATE TABLE IF NOT EXISTS emails (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            domain_id INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
            recipient_address TEXT NOT NULL,
            local_part TEXT NOT NULL,
            recipient_domain TEXT NOT NULL,
            envelope_from TEXT,
            sender_json TEXT,
            subject TEXT NOT NULL DEFAULT '(No Subject)',
            text_body TEXT NOT NULL DEFAULT '',
            html_body TEXT NOT NULL DEFAULT '',
            worker_name TEXT NOT NULL DEFAULT '',
            source_domain TEXT NOT NULL DEFAULT '',
            message_id TEXT NOT NULL DEFAULT '',
            received_at TEXT NOT NULL,
            raw_mime BLOB,
            created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
        );

        CREATE TABLE IF NOT EXISTS email_registers (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            domain_id INTEGER NOT NULL REFERENCES domains(id) ON DELETE CASCADE,
            recipient_address TEXT NOT NULL,
            local_part TEXT NOT NULL,
            recipient_domain TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(recipient_address)
        );

        CREATE TABLE IF NOT EXISTS groups (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            owner_user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
            name TEXT NOT NULL,
            color TEXT NOT NULL DEFAULT '#3B82F6',
            description TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            UNIQUE(owner_user_id, name)
        );

        CREATE TABLE IF NOT EXISTS group_emails (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            group_id INTEGER NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
            email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
            position INTEGER NOT NULL,
            added_at TEXT NOT NULL,
            added_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            UNIQUE(group_id, email_id),
            UNIQUE(group_id, position)
        );

        CREATE TABLE IF NOT EXISTS telegram_outbox (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            email_id INTEGER NOT NULL REFERENCES emails(id) ON DELETE CASCADE,
            chat_id TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'sending', 'sent', 'failed')),
            attempt_count INTEGER NOT NULL DEFAULT 0,
            next_attempt_at TEXT NOT NULL,
            last_error TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            sent_at TEXT,
            UNIQUE(email_id, chat_id)
        );

        CREATE TABLE IF NOT EXISTS system_settings (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS blocked_senders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            pattern_type TEXT NOT NULL CHECK(pattern_type IN ('email', 'domain')),
            pattern TEXT NOT NULL,
            domain_id INTEGER REFERENCES domains(id) ON DELETE CASCADE,
            reason TEXT NOT NULL DEFAULT '',
            status TEXT NOT NULL DEFAULT 'active' CHECK(status IN ('active', 'disabled')),
            match_count INTEGER NOT NULL DEFAULT 0,
            last_matched_at TEXT,
            created_by_user_id INTEGER REFERENCES users(id) ON DELETE SET NULL,
            created_by_label TEXT NOT NULL DEFAULT '',
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );
    `);

    await rebuildPermissionsTableIfNeeded(db);

    await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_domains_status ON domains (status, name);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_username_unique ON users (username);
        CREATE INDEX IF NOT EXISTS idx_users_status ON users (status, username);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_telegram_id ON users (telegram_id) WHERE telegram_id IS NOT NULL AND telegram_id != '';
        CREATE UNIQUE INDEX IF NOT EXISTS idx_users_api_key_hash ON users (api_key_hash) WHERE api_key_hash IS NOT NULL AND api_key_hash != '';
        CREATE INDEX IF NOT EXISTS idx_permissions_user_scope ON permissions (user_id, status, domain_id);
        CREATE INDEX IF NOT EXISTS idx_permissions_domain_scope ON permissions (domain_id, status);
        CREATE INDEX IF NOT EXISTS idx_admins_created_at ON admins (created_at);
        CREATE INDEX IF NOT EXISTS idx_user_sessions_user_expiry ON user_sessions (user_id, expires_at DESC);
        CREATE INDEX IF NOT EXISTS idx_user_sessions_expiry ON user_sessions (expires_at);
        CREATE INDEX IF NOT EXISTS idx_emails_domain_received ON emails (recipient_domain, received_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_emails_domain_local_received ON emails (recipient_domain, local_part, received_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_emails_recipient_received ON emails (recipient_address, received_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_emails_message_id ON emails (message_id);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_email_registers_recipient_unique ON email_registers (recipient_address);
        CREATE INDEX IF NOT EXISTS idx_email_registers_owner_updated ON email_registers (owner_user_id, updated_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_email_registers_domain_recipient ON email_registers (recipient_domain, recipient_address);
        CREATE INDEX IF NOT EXISTS idx_groups_owner_name ON groups (owner_user_id, name);
        CREATE INDEX IF NOT EXISTS idx_groups_owner_updated ON groups (owner_user_id, updated_at DESC, id DESC);
        CREATE INDEX IF NOT EXISTS idx_group_emails_group_position ON group_emails (group_id, position ASC, id ASC);
        CREATE INDEX IF NOT EXISTS idx_group_emails_email ON group_emails (email_id);
        CREATE INDEX IF NOT EXISTS idx_telegram_outbox_status_due ON telegram_outbox (status, next_attempt_at, id);
        CREATE INDEX IF NOT EXISTS idx_telegram_outbox_email ON telegram_outbox (email_id);
        CREATE INDEX IF NOT EXISTS idx_system_settings_updated_at ON system_settings (updated_at);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_blocked_senders_unique ON blocked_senders (pattern_type, pattern, COALESCE(domain_id, 0));
        CREATE INDEX IF NOT EXISTS idx_blocked_senders_lookup ON blocked_senders (status, pattern_type, pattern);
        CREATE INDEX IF NOT EXISTS idx_blocked_senders_domain_scope ON blocked_senders (domain_id, status, pattern_type);
    `);

    return db;
}

export async function getDb(config) {
    if (!dbPromise) {
        dbPromise = initializeDatabase(config);
    }

    return dbPromise;
}

export async function closeDb() {
    if (!dbPromise) {
        return;
    }

    const db = await dbPromise;
    await db.close();
    dbPromise = null;
}

export async function withTransaction(config, handler) {
    const runTransaction = async () => {
        const db = await getDb(config);
        await db.exec('BEGIN IMMEDIATE');

        try {
            const result = await handler(db);
            await db.exec('COMMIT');
            return result;
        } catch (error) {
            await db.exec('ROLLBACK');
            throw error;
        }
    };

    const transactionPromise = transactionQueue.then(runTransaction, runTransaction);
    transactionQueue = transactionPromise.catch(() => {});
    return transactionPromise;
}

export async function withDbLock(config, handler) {
    const runOperation = async () => {
        const db = await getDb(config);
        return handler(db);
    };

    const operationPromise = transactionQueue.then(runOperation, runOperation);
    transactionQueue = operationPromise.catch(() => {});
    return operationPromise;
}

async function statBytes(filePath) {
    try {
        const fileStat = await stat(filePath);
        return fileStat.size;
    } catch {
        return 0;
    }
}

async function getDirectorySizeBytes(directoryPath) {
    let entries;
    try {
        entries = await readdir(directoryPath, { withFileTypes: true });
    } catch {
        return 0;
    }

    let total = 0;
    for (const entry of entries) {
        const entryPath = path.join(directoryPath, entry.name);
        if (entry.isDirectory()) {
            total += await getDirectorySizeBytes(entryPath);
            continue;
        }

        if (entry.isFile()) {
            total += await statBytes(entryPath);
        }
    }

    return total;
}

export async function vacuumDatabase(config) {
    return withDbLock(config, async (db) => {
        const beforeMainBytes = await statBytes(config.sqlitePath);
        const beforeWalBytes = await statBytes(`${config.sqlitePath}-wal`);
        const beforeShmBytes = await statBytes(`${config.sqlitePath}-shm`);

        await db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
        await db.exec('VACUUM;');

        const afterMainBytes = await statBytes(config.sqlitePath);
        const afterWalBytes = await statBytes(`${config.sqlitePath}-wal`);
        const afterShmBytes = await statBytes(`${config.sqlitePath}-shm`);

        return {
            before: {
                sqliteBytes: beforeMainBytes,
                walBytes: beforeWalBytes,
                shmBytes: beforeShmBytes,
                totalBytes: beforeMainBytes + beforeWalBytes + beforeShmBytes
            },
            after: {
                sqliteBytes: afterMainBytes,
                walBytes: afterWalBytes,
                shmBytes: afterShmBytes,
                totalBytes: afterMainBytes + afterWalBytes + afterShmBytes
            }
        };
    });
}

export async function getStorageStats(config) {
    const storageDir = path.dirname(config.sqlitePath);
    const sqliteBytes = await statBytes(config.sqlitePath);
    const walBytes = await statBytes(`${config.sqlitePath}-wal`);
    const shmBytes = await statBytes(`${config.sqlitePath}-shm`);
    const folderBytes = await getDirectorySizeBytes(storageDir);

    return {
        storageDir,
        sqlitePath: config.sqlitePath,
        sqliteBytes,
        walBytes,
        shmBytes,
        sqliteTotalBytes: sqliteBytes + walBytes + shmBytes,
        folderBytes
    };
}

export async function maybePruneStoredRawMime(config, { force = false } = {}) {
    if (!config.storeRawMime || config.rawMimeRetentionDays <= 0) {
        return { skipped: true, updated: 0 };
    }

    const now = Date.now();
    if (!force && (pruneState.running || now - pruneState.lastRunAt < config.maintenancePruneIntervalMs)) {
        return { skipped: true, updated: 0 };
    }

    pruneState.running = true;

    try {
        const db = await getDb(config);
        const result = await db.run(
            `
                UPDATE emails
                SET raw_mime = NULL
                WHERE raw_mime IS NOT NULL
                  AND received_at < datetime('now', ?)
            `,
            [`-${config.rawMimeRetentionDays} days`]
        );

        pruneState.lastRunAt = now;
        return {
            skipped: false,
            updated: result.changes || 0
        };
    } finally {
        pruneState.running = false;
    }
}
