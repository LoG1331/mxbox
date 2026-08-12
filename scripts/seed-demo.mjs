#!/usr/bin/env node
// Seed demo data for the email_worker server. Run: node scripts/seed-demo.mjs
// Idempotent: uses INSERT OR IGNORE / ON CONFLICT, so re-running it does not duplicate data.

import { randomBytes, scrypt as scryptCallback } from 'node:crypto';
import path from 'node:path';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import sqlite3 from 'sqlite3';
import { open } from 'sqlite';

const scrypt = promisify(scryptCallback);
const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const DB_PATH = process.env.NEW_SERVER_SQLITE_PATH || path.join(ROOT_DIR, 'data', 'new-server.sqlite');
const DEMO_PASSWORD = process.env.SEED_USER_PASSWORD || 'demo1234';

const now = () => new Date().toISOString();
const daysAgo = (days, hours = 0) => new Date(Date.now() - days * 864e5 - hours * 36e5).toISOString();

async function hashPassword(password) {
    const salt = randomBytes(16).toString('base64url');
    const derivedKey = await scrypt(password, salt, 64);
    return `scrypt$${salt}$${Buffer.from(derivedKey).toString('base64url')}`;
}

const db = await open({ filename: DB_PATH, driver: sqlite3.Database });
await db.exec('PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');

const passwordHash = await hashPassword(DEMO_PASSWORD);
const ts = now();

// --- Domains ---
const domains = [
    { name: 'example.com', description: 'Main demo domain', is_default: 1 },
    { name: 'mail.demo.dev', description: 'Feature test domain', is_default: 0 },
    { name: 'test-site.org', description: 'Staging domain', is_default: 0 }
];
for (const d of domains) {
    await db.run(
        `INSERT OR IGNORE INTO domains (name, description, status, inbound_enabled, is_default, created_at, updated_at)
         VALUES (?, ?, 'active', 1, ?, ?, ?)`,
        [d.name, d.description, d.is_default, ts, ts]
    );
}
const domainRows = await db.all('SELECT id, name FROM domains');
const domainId = Object.fromEntries(domainRows.map(r => [r.name, r.id]));

// --- Users ---
const users = [
    { username: 'alice', display_name: 'Alice Nguyen', telegram_id: '100200300' },
    { username: 'bob', display_name: 'Bob Tran', telegram_id: null },
    { username: 'charlie', display_name: 'Charlie Le', telegram_id: '400500600' }
];
for (const u of users) {
    await db.run(
        `INSERT OR IGNORE INTO users (username, display_name, telegram_id, password_hash, status, created_at, updated_at, last_seen_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`,
        [u.username, u.display_name, u.telegram_id, passwordHash, ts, ts, daysAgo(0, 3)]
    );
}
const userRows = await db.all('SELECT id, username FROM users');
const userId = Object.fromEntries(userRows.map(r => [r.username, r.id]));
const adminRow = await db.get('SELECT id FROM users WHERE username = ?', ['admin']);

// --- Admins: bob as a secondary admin ---
if (userId.bob) {
    await db.run(
        `INSERT OR IGNORE INTO admins (user_id, granted_by_user_id, granted_by_label, created_at)
         VALUES (?, ?, 'seed-script', ?)`,
        [userId.bob, adminRow?.id ?? null, ts]
    );
}

// --- Permissions: user <-> domain ---
const grants = [
    ['alice', 'example.com'], ['alice', 'mail.demo.dev'],
    ['bob', 'example.com'], ['bob', 'test-site.org'],
    ['charlie', 'mail.demo.dev']
];
for (const [username, domainName] of grants) {
    if (!userId[username] || !domainId[domainName]) continue;
    await db.run(
        `INSERT OR IGNORE INTO permissions (user_id, domain_id, status, granted_by_user_id, granted_by_label, created_at, updated_at)
         VALUES (?, ?, 'active', ?, 'seed-script', ?, ?)`,
        [userId[username], domainId[domainName], adminRow?.id ?? null, ts, ts]
    );
}

// --- Email registers ---
const mailboxes = [
    { owner: 'alice', address: 'alice@example.com' },
    { owner: 'alice', address: 'support@example.com' },
    { owner: 'bob', address: 'bob@example.com' },
    { owner: 'bob', address: 'bob@test-site.org' },
    { owner: 'charlie', address: 'charlie@mail.demo.dev' },
    { owner: 'charlie', address: 'hello@mail.demo.dev' }
];
for (const m of mailboxes) {
    const [localPart, recipientDomain] = m.address.split('@');
    if (!userId[m.owner] || !domainId[recipientDomain]) continue;
    await db.run(
        `INSERT OR IGNORE INTO email_registers (owner_user_id, domain_id, recipient_address, local_part, recipient_domain, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [userId[m.owner], domainId[recipientDomain], m.address, localPart, recipientDomain, ts, ts]
    );
}

// --- Emails ---
const senders = [
    { name: 'GitHub', address: 'noreply@github.com' },
    { name: 'Stripe', address: 'receipts@stripe.com' },
    { name: 'Unknown sender', address: 'spam-promo@shady-ads.xyz' },
    { name: 'Linh Pham', address: 'linh.pham@partner.vn' },
    { name: 'AWS Notifications', address: 'no-reply-aws@amazon.com' },
    { name: 'Vercel', address: 'notifications@vercel.com' }
];
const subjects = [
    '[GitHub] Pull request #128 merged into main',
    'Stripe payment receipt for August',
    'INVESTMENT OPPORTUNITY YOU CANNOT MISS!!!',
    'Landing page design quote - from Linh',
    'AWS: Cost warning above 80% threshold',
    'Deployment successful: mail-dashboard',
    'Re: Contract discussion meeting next week',
    'Password reset request for your account',
    'Weekly newsletter: 5 DNS optimization tips',
    'Invoice #INV-2026-0811 is overdue',
    'Welcome to the new mail system',
    'Server maintenance notice tonight at 23:00',
    '[CI] Build failed on branch feature/auth',
    'Security policy update 2026',
    'Customer feedback on the new UI'
];
const recipients = [
    'alice@example.com', 'support@example.com', 'bob@example.com',
    'bob@test-site.org', 'charlie@mail.demo.dev', 'hello@mail.demo.dev'
];

const sampleText = 'Hello,\n\nThis is a demo email seeded automatically to test the UI.\n\nRegards.';
const sampleHtml = `<div style="font-family:sans-serif;padding:16px">
  <h2 style="color:#0ea5e9">Demo email</h2>
  <p>This is an <b>HTML</b> email seeded automatically to test the UI.</p>
  <p style="color:#888">— Mail Dashboard seed script</p>
</div>`;

const existingEmails = await db.get('SELECT COUNT(*) AS c FROM emails');
if (existingEmails.c === 0) {
    for (let i = 0; i < subjects.length; i += 1) {
        const recipient = recipients[i % recipients.length];
        const [localPart, recipientDomain] = recipient.split('@');
        const sender = senders[i % senders.length];
        const receivedAt = daysAgo(Math.floor(i / 3), (i * 7) % 24);
        await db.run(
            `INSERT INTO emails (domain_id, recipient_address, local_part, recipient_domain, envelope_from, sender_json,
                                 subject, text_body, html_body, worker_name, source_domain, message_id, received_at, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'seed-worker', ?, ?, ?, ?)`,
            [
                domainId[recipientDomain], recipient, localPart, recipientDomain,
                sender.address, JSON.stringify(sender),
                subjects[i], sampleText, i % 3 === 0 ? sampleHtml : '',
                sender.address.split('@')[1], `<seed-${i + 1}@mail.demo>`, receivedAt, receivedAt
            ]
        );
    }
    console.log(`Inserted ${subjects.length} emails.`);
} else {
    console.log(`Emails table already has ${existingEmails.c} rows — skipping.`);
}

// --- Blocked senders ---
const blocked = [
    { pattern_type: 'domain', pattern: 'shady-ads.xyz', domain: null, reason: 'Advertising spam', match_count: 12 },
    { pattern_type: 'email', pattern: 'spam-promo@shady-ads.xyz', domain: 'example.com', reason: 'Repeated spam sending', match_count: 5 },
    { pattern_type: 'email', pattern: 'phishing@evil.io', domain: null, reason: 'Bank impersonation', match_count: 2 }
];
for (const b of blocked) {
    await db.run(
        `INSERT OR IGNORE INTO blocked_senders (pattern_type, pattern, domain_id, reason, status, match_count, last_matched_at,
                                                created_by_user_id, created_by_label, created_at, updated_at)
         VALUES (?, ?, ?, ?, 'active', ?, ?, ?, 'seed-script', ?, ?)`,
        [b.pattern_type, b.pattern, b.domain ? domainId[b.domain] : null, b.reason, b.match_count,
         daysAgo(1, 5), adminRow?.id ?? null, ts, ts]
    );
}

const stats = await db.all(`SELECT 'domains' t, COUNT(*) c FROM domains
    UNION ALL SELECT 'users', COUNT(*) FROM users
    UNION ALL SELECT 'permissions', COUNT(*) FROM permissions
    UNION ALL SELECT 'emails', COUNT(*) FROM emails
    UNION ALL SELECT 'blocked_senders', COUNT(*) FROM blocked_senders`);
console.log('Seed done:', Object.fromEntries(stats.map(r => [r.t, r.c])));
console.log(`Demo users: ${users.map(u => u.username).join(', ')} — shared password: ${DEMO_PASSWORD}`);

await db.close();
