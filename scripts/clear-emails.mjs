#!/usr/bin/env node
// Delete all stored emails directly from the SQLite database.
// Zero dependencies — uses the node:sqlite module built into Node >= 22.5.
//
// Usage:
//   node scripts/clear-emails.mjs              # uses NEW_SERVER_SQLITE_PATH or data/new-server.sqlite
//   node scripts/clear-emails.mjs --db <path>  # explicit db path
//   node scripts/clear-emails.mjs --yes        # skip confirmation
//
// Safe to run while the server is up (SQLite WAL mode handles concurrency).

import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const PROJECT_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function parseArgs(argv) {
    const args = { dbPath: process.env.NEW_SERVER_SQLITE_PATH || path.join(PROJECT_ROOT, 'data', 'new-server.sqlite'), yes: false };
    for (let i = 0; i < argv.length; i += 1) {
        if (argv[i] === '--db') {
            args.dbPath = argv[i + 1];
            i += 1;
        } else if (argv[i] === '--yes' || argv[i] === '-y') {
            args.yes = true;
        }
    }
    return args;
}

async function confirm(question) {
    const { createInterface } = await import('node:readline');
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await new Promise((resolve) => rl.question(question, resolve));
    rl.close();
    return /^y(es)?$/i.test(answer.trim());
}

async function main() {
    const args = parseArgs(process.argv.slice(2));
    const dbPath = path.resolve(args.dbPath);

    if (!existsSync(dbPath)) {
        console.error(`Database not found: ${dbPath}`);
        process.exit(1);
    }

    console.log(`Database: ${dbPath}`);

    const db = new DatabaseSync(dbPath);
    db.exec(`
        PRAGMA foreign_keys = ON;
        PRAGMA busy_timeout = 5000;
    `);

    const { emailCount } = db.prepare('SELECT COUNT(*) AS emailCount FROM emails').get();
    console.log(`Emails currently stored: ${emailCount}`);

    if (emailCount === 0) {
        console.log('Nothing to delete.');
        db.close();
        return;
    }

    if (!args.yes && !(await confirm('Delete ALL emails (including linked group entries and Telegram outbox rows)? [y/N] '))) {
        console.log('Aborted.');
        db.close();
        return;
    }

    // telegram_outbox and group_emails reference emails; deleting children
    // first keeps the cascade work explicit and cheap.
    const outbox = db.prepare('DELETE FROM telegram_outbox').run();
    const grouped = db.prepare('DELETE FROM group_emails').run();
    const emails = db.prepare('DELETE FROM emails').run();
    db.exec(`DELETE FROM sqlite_sequence WHERE name IN ('emails', 'telegram_outbox', 'group_emails');`);
    db.exec('VACUUM;');

    console.log(`Deleted: ${emails.changes} emails, ${grouped.changes} group links, ${outbox.changes} outbox rows.`);
    console.log('Vacuumed database.');

    db.close();
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
