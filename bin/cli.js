#!/usr/bin/env node
// mxbox CLI — runs the mail server backend and the prebuilt frontend
// in a single process.
//
//   npx mxbox            # or after global install: mxbox
//   mxbox --port 8080 --host 0.0.0.0
//
// On first run it creates ~/.local/mxbox/ (DB + .env with random
// secrets) and prints the admin password exactly once.
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PKG_ROOT = path.join(__dirname, "..");

// Tiny .env parser (zero dependencies; does not override existing env)
const loadEnv = (file) => {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, "utf8").split("\n")) {
    const m = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (m && process.env[m[1]] === undefined) process.env[m[1]] = m[2];
  }
};

// ---------- CLI args ----------
const args = process.argv.slice(2);
if (args.includes("--help") || args.includes("-h")) {
  console.log(`mxbox — self-hosted email server dashboard

Usage: mxbox [options]

Options:
  --port <n>     Port to listen on (default 3001)
  --host <addr>  Listen address, IP or 0.0.0.0 (default 0.0.0.0)
  --help         Show this help

Config lives in ~/.local/mxbox/ (or $MXBOX_HOME).`);
  process.exit(0);
}
const argValue = (flag) => {
  const i = args.indexOf(flag);
  return i >= 0 ? args[i + 1] : undefined;
};

// ---------- Data dir + first-run seed ----------
const dataDir =
  process.env.MXBOX_HOME ||
  path.join(os.homedir(), ".local", "mxbox");
fs.mkdirSync(dataDir, { recursive: true });

const envFile = path.join(dataDir, ".env");
const ALNUM = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789";
const ALNUM_SPECIAL = ALNUM + "!@#%";
const gen = (chars, n) =>
  Array.from({ length: n }, () => chars[crypto.randomInt(chars.length)]).join(
    ""
  );

let firstRun = false;
let adminPass = "";
if (!fs.existsSync(envFile)) {
  firstRun = true;
  adminPass = `Adm!n-${gen(ALNUM_SPECIAL, 16)}`;
  fs.writeFileSync(
    envFile,
    [
      `PORT=${argValue("--port") || 3001}`,
      `HOST=${argValue("--host") || "0.0.0.0"}`,
      `INBOUND_AUTH_TOKEN=${gen(ALNUM, 48)}`,
      `BOOTSTRAP_ADMIN_USERNAME=admin`,
      `BOOTSTRAP_ADMIN_PASSWORD=${adminPass}`,
      "",
    ].join("\n")
  );
}
loadEnv(envFile);

// CLI args override .env
if (argValue("--port")) process.env.PORT = argValue("--port");
if (argValue("--host")) process.env.HOST = argValue("--host");

// ---------- npm package mode: single bundled file, frontend embedded ----------
process.env.FRONTEND_EMBED = "true";
process.env.NEW_SERVER_SQLITE_PATH = path.join(dataDir, "mxbox.sqlite");

await import(path.join(PKG_ROOT, "bundle", "mxbox.js"));

if (firstRun) {
  console.log("");
  console.log("============================================================");
  console.log("  First run — admin account created:");
  console.log(`  Username: admin`);
  console.log(`  Password: ${adminPass}   <-- SAVE IT, shown only once`);
  console.log("============================================================");
}
