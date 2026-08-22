#!/usr/bin/env node
// Merge third-level domains into their second-level parent, then delete the
// child rows. Zero dependencies — uses the node:sqlite module (Node >= 22.5).
//
// What moves to the parent: emails, email_registers, permissions.
// recipient_address values are kept as-is (a mailbox registered under
// a@sub.parent.com stays a@sub.parent.com, just filed under the parent).
// What is kept untouched: users, admins, blocked_senders, groups.
//
// Usage:
//   node scripts/consolidate-domains.mjs              # NEW_SERVER_SQLITE_PATH or data/new-server.sqlite
//   node scripts/consolidate-domains.mjs --db <path>
//   node scripts/consolidate-domains.mjs --yes        # skip confirmation
//
// Safe to run while the server is up (SQLite WAL mode handles concurrency).
// Idempotent: re-running after a successful merge finds no third-level rows.

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

// second-level = last two labels
const parentOf = (name) => name.split('.').slice(-2).join('.');

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

    const domains = db.prepare('SELECT * FROM domains ORDER BY name ASC').all();
    const byName = new Map(domains.map((d) => [d.name, d]));
    const counts = (id) => ({
        emails: db.prepare('SELECT COUNT(*) AS n FROM emails WHERE domain_id = ?').get(id).n,
        registers: db.prepare('SELECT COUNT(*) AS n FROM email_registers WHERE domain_id = ?').get(id).n,
        permissions: db.prepare('SELECT COUNT(*) AS n FROM permissions WHERE domain_id = ?').get(id).n,
    });

    // third-level = exactly one label above the parent, and not the parent itself
    const children = domains.filter((d) => d.name.split('.').length === 3);
    if (!children.length) {
        console.log('No third-level domains found — nothing to consolidate.');
        db.close();
        return;
    }

    console.log(`\nThird-level domains to merge into their parent:`);
    for (const c of children) {
        const n = counts(c.id);
        console.log(`  ${c.name} -> ${parentOf(c.name)}  (emails=${n.emails}, registers=${n.registers}, perms=${n.permissions})`);
    }

    if (!args.yes && !(await confirm(`\nMerge ${children.length} domains into their parents and delete the child rows? [y/N] `))) {
        console.log('Aborted.');
        db.close();
        return;
    }

    const now = () => new Date().toISOString();

    for (const child of children) {
        const parentName = parentOf(child.name);
        let parent = byName.get(parentName);

        db.exec('BEGIN');
        try {
            if (!parent) {
                const ts = now();
                const result = db.prepare(
                    `INSERT INTO domains (name, description, status, inbound_enabled, is_default, created_at, updated_at)
                     VALUES (?, '', 'active', 1, 0, ?, ?)`
                ).run(parentName, ts, ts);
                parent = db.prepare('SELECT * FROM domains WHERE id = ?').get(result.lastInsertRowid);
                byName.set(parentName, parent);
                console.log(`  created parent domain ${parentName}`);
            }

            // move rows; recipient_address is preserved verbatim
            const moved = {
                emails: db.prepare('UPDATE emails SET domain_id = ?, recipient_domain = ? WHERE domain_id = ?').run(parent.id, parentName, child.id).changes,
                registers: db.prepare('UPDATE email_registers SET domain_id = ?, recipient_domain = ? WHERE domain_id = ?').run(parent.id, parentName, child.id).changes,
            };

            // permissions: repoint, dropping duplicates already on the parent
            const childPerms = db.prepare('SELECT * FROM permissions WHERE domain_id = ?').all(child.id);
            let permsMoved = 0;
            let permsDropped = 0;
            for (const p of childPerms) {
                const dup = db.prepare('SELECT id FROM permissions WHERE user_id = ? AND domain_id = ?').get(p.user_id, parent.id);
                if (dup) {
                    db.prepare('DELETE FROM permissions WHERE id = ?').run(p.id);
                    permsDropped += 1;
                } else {
                    db.prepare('UPDATE permissions SET domain_id = ? WHERE id = ?').run(parent.id, p.id);
                    permsMoved += 1;
                }
            }

            db.prepare('DELETE FROM domains WHERE id = ?').run(child.id);
            db.exec('COMMIT');
            console.log(`  merged ${child.name}: emails=${moved.emails}, registers=${moved.registers}, perms=${permsMoved} (dropped ${permsDropped} duplicates)`);
        } catch (error) {
            db.exec('ROLLBACK');
            console.error(`  FAILED to merge ${child.name}: ${error.message}`);
            db.close();
            process.exit(1);
        }
    }

    const remaining = db.prepare('SELECT COUNT(*) AS n FROM domains').get().n;
    console.log(`\nDone. ${remaining} domains remain:`);
    for (const d of db.prepare('SELECT name FROM domains ORDER BY name ASC').all()) {
        console.log(`  ${d.name}`);
    }

    db.close();
}

main().catch((error) => {
    console.error(error.message);
    process.exit(1);
});
