import express from 'express';
import { asyncHandler } from '../utils/async-handler.mjs';
import { handleTelegramUpdate } from '../telegram/bot-service.mjs';
import { getTelegramSettings } from '../services/telegram-settings-service.mjs';

export function createTelegramRouter(config) {
    const router = express.Router();

    router.post('/webhook', asyncHandler(async (req, res) => {
        const settings = await getTelegramSettings(config);
        const secret = String(req.header('x-telegram-bot-api-secret-token') || '').trim();
        if (!secret || !settings.webhookSecret || secret !== settings.webhookSecret) {
            return res.status(401).json({
                error: 'Unauthorized',
                requestId: req.requestId
            });
        }

        const result = await handleTelegramUpdate(config, req.body ?? {});
        return res.json({
            success: true,
            handled: Boolean(result?.handled),
            requestId: req.requestId
        });
    }));

    return router;
}
