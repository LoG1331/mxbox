#!/usr/bin/env node
// Delete all mailbox registrations directly from the SQLite database.
// Zero dependencies — uses the node:sqlite module built into Node >= 22.5.
//
// Usage:
//   node scripts/clear-registers.mjs              # uses NEW_SERVER_SQLITE_PATH or data/new-server.sqlite
//   node scripts/clear-registers.mjs --db <path>  # explicit db path
//   node scripts/clear-registers.mjs --yes        # skip confirmation
//
// Safe to run while the server is up (SQLite WAL mode handles concurrency).
// Domains, users, permissions and stored emails are NOT touched.

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

    const { regCount } = db.prepare('SELECT COUNT(*) AS regCount FROM email_registers').get();
    console.log(`Mailbox registrations currently stored: ${regCount}`);

    if (regCount === 0) {
        console.log('Nothing to delete.');
        db.close();
        return;
    }

    if (!args.yes && !(await confirm('Delete ALL mailbox registrations (domains, users, permissions and emails are kept)? [y/N] '))) {
        console.log('Aborted.');
        db.close();
        return;
    }

    const result = db.prepare('DELETE FROM email_registers').run();
    db.exec(`DELETE FROM sqlite_sequence WHERE name = 'email_registers';`);

    console.log(`Deleted ${result.changes} mailbox registrations.`);

    db.close();
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
