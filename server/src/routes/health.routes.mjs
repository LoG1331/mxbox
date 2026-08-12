import express from 'express';
import { asyncHandler } from '../utils/async-handler.mjs';
import { getDb } from '../db/index.mjs';
import { getTelegramRuntimeStatus } from '../telegram/runtime.mjs';

export function createHealthRouter(config) {
    const router = express.Router();

    router.get('/', asyncHandler(async (req, res) => {
        await getDb(config);
        const now = new Date();
        const telegramRuntime = await getTelegramRuntimeStatus(config);
        res.json({
            ok: true,
            service: 'server',
            nodeEnv: config.nodeEnv,
            systemTime: now.toISOString(),
            systemTimeMs: now.getTime(),
            storage: {
                engine: 'sqlite',
                ready: true
            },
            telegram: {
                enabled: telegramRuntime.enabled,
                workerActive: telegramRuntime.workerActive,
                processing: telegramRuntime.processing,
                lastWebhookRegisteredAt: telegramRuntime.lastWebhookRegisteredAt,
                lastPollAt: telegramRuntime.lastPollAt,
                lastDeliveryAt: telegramRuntime.lastDeliveryAt,
                lastError: telegramRuntime.lastError,
                outbox: telegramRuntime.outbox
            },
            requestId: req.requestId
        });
    }));

    return router;
}
