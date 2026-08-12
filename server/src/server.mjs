import { createApp } from './app.mjs';
import { loadConfig } from './config.mjs';
import { closeDb, getDb, maybePruneStoredRawMime } from './db/index.mjs';
import { ensureBootstrapAdmin, revokeExpiredSessions } from './services/account-service.mjs';
import { ensureAuthSecrets } from './services/auth-secrets-service.mjs';
import { startTelegramRuntime, stopTelegramRuntime } from './telegram/runtime.mjs';

const config = loadConfig();
await getDb(config);
await ensureAuthSecrets(config);
await maybePruneStoredRawMime(config, { force: true });
await revokeExpiredSessions(config);
await ensureBootstrapAdmin(config);
await startTelegramRuntime(config);

const app = createApp(config);
const server = app.listen(config.port, config.host, () => {
    console.log(`server listening on http://${config.host}:${config.port}`);
});

async function shutdown(signal) {
    console.log(`Received ${signal}, shutting down server`);
    server.close(async () => {
        try {
            await stopTelegramRuntime();
            await closeDb();
        } finally {
            process.exit(0);
        }
    });
}

process.on('SIGINT', () => {
    void shutdown('SIGINT');
});

process.on('SIGTERM', () => {
    void shutdown('SIGTERM');
});
