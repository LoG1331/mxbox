import express from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/async-handler.mjs';
import { assertSuperAdmin } from '../services/account-service.mjs';
import {
    getPublicTelegramSettings,
    getTelegramSettings,
    replaceTelegramSettings,
    updateTelegramSettings
} from '../services/telegram-settings-service.mjs';
import { registerTelegramCommands } from '../telegram/bot-service.mjs';
import { getTelegramRuntimeStatus, reloadTelegramRuntime } from '../telegram/runtime.mjs';

const telegramSettingsSchema = z.object({
    enabled: z.boolean().optional(),
    publicBaseUrl: z.string().optional(),
    botToken: z.union([z.string(), z.null()]).optional(),
    clearBotToken: z.boolean().optional()
});

export function createSystemRouter(config) {
    const router = express.Router();

    router.get('/telegram', asyncHandler(async (req, res) => {
        assertSuperAdmin(req.auth);
        const settings = await getPublicTelegramSettings(config);
        const runtime = await getTelegramRuntimeStatus(config);
        res.json({
            settings,
            runtime,
            requestId: req.requestId
        });
    }));

    router.patch('/telegram', asyncHandler(async (req, res) => {
        assertSuperAdmin(req.auth);
        const previousSettings = {
            ...(await getTelegramSettings(config))
        };
        const payload = telegramSettingsSchema.parse(req.body ?? {});
        const settings = await updateTelegramSettings(config, payload);
        let runtime = null;
        try {
            await reloadTelegramRuntime(config);
        } catch (error) {
            let rollbackError = null;
            try {
                await replaceTelegramSettings(config, previousSettings);
                await reloadTelegramRuntime(config);
            } catch (restoreError) {
                rollbackError = restoreError;
            }

            runtime = await getTelegramRuntimeStatus(config);
            const restoredSettings = await getPublicTelegramSettings(config);
            return res.status(502).json({
                error: error?.message || 'Failed to reload Telegram runtime',
                settings: restoredSettings,
                runtime,
                rolledBack: !rollbackError,
                rollbackError: rollbackError?.message || null,
                requestId: req.requestId
            });
        }

        runtime = await getTelegramRuntimeStatus(config);
        res.json({
            success: true,
            settings,
            runtime,
            requestId: req.requestId
        });
    }));

    router.post('/telegram/commands/register', asyncHandler(async (req, res) => {
        assertSuperAdmin(req.auth);
        const result = await registerTelegramCommands(config);
        const runtime = await getTelegramRuntimeStatus(config);
        res.json({
            success: true,
            ...result,
            runtime,
            requestId: req.requestId
        });
    }));

    return router;
}
