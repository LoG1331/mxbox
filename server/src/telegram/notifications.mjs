import { convert } from 'html-to-text';
import { getDb, withTransaction } from '../db/index.mjs';
import { createTelegramClient } from './client.mjs';
import { getTelegramSettings } from '../services/telegram-settings-service.mjs';

const TELEGRAM_MESSAGE_LIMIT = 4096;
const MAX_ERROR_LENGTH = 500;

function nowIso() {
    return new Date().toISOString();
}

function truncateError(error) {
    return String(error?.message || error || 'Unknown Telegram error').slice(0, MAX_ERROR_LENGTH);
}

function toPlainText(textBody, htmlBody) {
    const text = String(textBody || '').trim();
    if (text) {
        return text;
    }

    const html = String(htmlBody || '').trim();
    if (!html) {
        return '(No content)';
    }

    const converted = convert(html, {
        wordwrap: false
    }).trim();

    return converted || '(No content)';
}

function splitText(text, maxLength = TELEGRAM_MESSAGE_LIMIT) {
    const normalized = String(text || '').trim();
    if (!normalized) {
        return [''];
    }

    const chunks = [];
    let current = normalized;
    while (current.length > maxLength) {
        let splitIndex = current.lastIndexOf('\n', maxLength);
        if (splitIndex < Math.floor(maxLength / 2)) {
            splitIndex = current.lastIndexOf(' ', maxLength);
        }
        if (splitIndex < Math.floor(maxLength / 2)) {
            splitIndex = maxLength;
        }

        chunks.push(current.slice(0, splitIndex).trimEnd());
        current = current.slice(splitIndex).trimStart();
    }

    if (current) {
        chunks.push(current);
    }

    return chunks.length ? chunks : [''];
}

function formatEmailTimestamp(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value || 'Unknown';
    }

    return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function formatNotificationText(row) {
    const body = toPlainText(row.text_body, row.html_body);
    const header = [
        'New email received',
        `Mailbox: ${row.recipient_address}`,
        `From: ${row.from_address || row.envelope_from || 'Unknown'}`,
        `Subject: ${row.subject || '(No Subject)'}`,
        `Received: ${formatEmailTimestamp(row.received_at)}`,
        '',
        body
    ].join('\n');

    return splitText(header);
}

async function getNotificationTargetForEmail(db, emailId) {
    return db.get(
        `
            SELECT
                e.id AS email_id,
                u.telegram_id AS chat_id
            FROM emails e
            JOIN email_registers er ON er.recipient_address = e.recipient_address
            JOIN users u ON u.id = er.owner_user_id
            WHERE e.id = ?
              AND u.status = 'active'
              AND u.telegram_id IS NOT NULL
              AND u.telegram_id != ''
            LIMIT 1
        `,
        [emailId]
    );
}

async function loadNotificationPayload(db, emailId, chatId) {
    return db.get(
        `
            SELECT
                e.id,
                e.recipient_address,
                e.envelope_from,
                e.subject,
                e.text_body,
                e.html_body,
                e.received_at,
                json_extract(e.sender_json, '$.address') AS from_address,
                ? AS chat_id
            FROM emails e
            WHERE e.id = ?
            LIMIT 1
        `,
        [chatId, emailId]
    );
}

function computeNextAttemptAt(config, attemptCount) {
    const backoffMs = config.telegramOutboxBaseBackoffMs * Math.max(1, 2 ** Math.max(0, attemptCount - 1));
    return new Date(Date.now() + backoffMs).toISOString();
}

async function markOutboxEntrySent(config, entryId) {
    const db = await getDb(config);
    const timestamp = nowIso();
    await db.run(
        `
            UPDATE telegram_outbox
            SET status = 'sent',
                updated_at = ?,
                sent_at = ?,
                last_error = ''
            WHERE id = ?
        `,
        [timestamp, timestamp, entryId]
    );
}

async function markOutboxEntryFailed(config, entry, error) {
    const db = await getDb(config);
    const status = entry.attempt_count >= config.telegramOutboxMaxAttempts ? 'failed' : 'pending';
    const nextAttemptAt = status === 'pending'
        ? computeNextAttemptAt(config, entry.attempt_count)
        : entry.next_attempt_at;
    await db.run(
        `
            UPDATE telegram_outbox
            SET status = ?,
                updated_at = ?,
                next_attempt_at = ?,
                last_error = ?
            WHERE id = ?
        `,
        [status, nowIso(), nextAttemptAt, truncateError(error), entry.id]
    );
}

async function claimNextOutboxEntry(config) {
    return withTransaction(config, async (db) => {
        const dueAt = nowIso();
        const row = await db.get(
            `
                SELECT *
                FROM telegram_outbox
                WHERE status = 'pending'
                  AND next_attempt_at <= ?
                ORDER BY next_attempt_at ASC, id ASC
                LIMIT 1
            `,
            [dueAt]
        );

        if (!row) {
            return null;
        }

        const attemptCount = Number(row.attempt_count || 0) + 1;
        await db.run(
            `
                UPDATE telegram_outbox
                SET status = 'sending',
                    attempt_count = ?,
                    updated_at = ?
                WHERE id = ?
            `,
            [attemptCount, nowIso(), row.id]
        );

        return {
            ...row,
            attempt_count: attemptCount
        };
    });
}

async function deliverOutboxEntry(config, entry) {
    const db = await getDb(config);
    const payload = await loadNotificationPayload(db, entry.email_id, entry.chat_id);
    if (!payload) {
        throw new Error(`Email ${entry.email_id} no longer exists`);
    }

    const client = createTelegramClient(config);
    const messages = formatNotificationText(payload);
    for (const text of messages) {
        await client.sendMessage(entry.chat_id, text);
    }
}

export async function enqueueInboundEmailNotification(config, emailId) {
    const settings = await getTelegramSettings(config);
    if (!settings.enabled || !settings.botToken) {
        return { queued: false, reason: 'disabled' };
    }

    return withTransaction(config, async (db) => {
        const target = await getNotificationTargetForEmail(db, emailId);
        if (!target?.chat_id) {
            return { queued: false, reason: 'no-recipient' };
        }

        const existing = await db.get(
            `
                SELECT id, status
                FROM telegram_outbox
                WHERE email_id = ?
                  AND chat_id = ?
                LIMIT 1
            `,
            [emailId, target.chat_id]
        );

        if (existing?.status === 'sent') {
            return { queued: false, reason: 'already-sent', chatId: target.chat_id };
        }

        const timestamp = nowIso();
        if (existing) {
            await db.run(
                `
                    UPDATE telegram_outbox
                    SET status = 'pending',
                        next_attempt_at = ?,
                        updated_at = ?,
                        last_error = ''
                    WHERE id = ?
                `,
                [timestamp, timestamp, existing.id]
            );
            return { queued: true, chatId: target.chat_id, outboxId: existing.id };
        }

        const result = await db.run(
            `
                INSERT INTO telegram_outbox (
                    email_id,
                    chat_id,
                    status,
                    attempt_count,
                    next_attempt_at,
                    last_error,
                    created_at,
                    updated_at,
                    sent_at
                )
                VALUES (?, ?, 'pending', 0, ?, '', ?, ?, NULL)
            `,
            [emailId, target.chat_id, timestamp, timestamp, timestamp]
        );

        return { queued: true, chatId: target.chat_id, outboxId: result.lastID };
    });
}

export async function processTelegramOutbox(config, { limit = 10 } = {}) {
    const settings = await getTelegramSettings(config);
    if (!settings.enabled || !settings.botToken) {
        return { processed: 0, sent: 0, failed: 0 };
    }

    const max = Math.max(1, Number.parseInt(String(limit), 10) || 1);
    let processed = 0;
    let sent = 0;
    let failed = 0;

    while (processed < max) {
        const entry = await claimNextOutboxEntry(config);
        if (!entry) {
            break;
        }

        processed += 1;
        try {
            await deliverOutboxEntry(config, entry);
            await markOutboxEntrySent(config, entry.id);
            sent += 1;
            console.log(`Telegram outbox delivered email ${entry.email_id} to ${entry.chat_id}`);
        } catch (error) {
            await markOutboxEntryFailed(config, entry, error);
            failed += 1;
            console.error(`Telegram outbox delivery failed for email ${entry.email_id}:`, error);
        }
    }

    return {
        processed,
        sent,
        failed
    };
}

export async function recoverTelegramOutbox(config) {
    const settings = await getTelegramSettings(config);
    if (!settings.enabled || !settings.botToken) {
        return { recovered: 0 };
    }

    const db = await getDb(config);
    const timestamp = nowIso();
    const result = await db.run(
        `
            UPDATE telegram_outbox
            SET status = 'pending',
                next_attempt_at = ?,
                updated_at = ?,
                last_error = CASE
                    WHEN last_error = '' THEN 'Recovered from interrupted send attempt'
                    ELSE last_error
                END
            WHERE status = 'sending'
        `,
        [timestamp, timestamp]
    );

    return {
        recovered: result.changes || 0
    };
}

export async function getTelegramOutboxStats(config) {
    const settings = await getTelegramSettings(config);
    if (!settings.enabled || !settings.botToken) {
        return {
            pending: 0,
            sending: 0,
            sent: 0,
            failed: 0
        };
    }

    const db = await getDb(config);
    const rows = await db.all(
        `
            SELECT status, COUNT(*) AS count
            FROM telegram_outbox
            GROUP BY status
        `
    );

    const stats = {
        pending: 0,
        sending: 0,
        sent: 0,
        failed: 0
    };
    for (const row of rows) {
        if (row.status in stats) {
            stats[row.status] = row.count;
        }
    }

    return stats;
}
