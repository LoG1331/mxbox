import express from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/async-handler.mjs';
import { getStorageStats } from '../db/index.mjs';
import { assertSuperAdmin } from '../services/account-service.mjs';
import { pruneEmails, pruneStoredRawMime } from '../services/email-service.mjs';

const pruneEmailsSchema = z.object({
    olderThanDays: z.union([z.number().int().min(0), z.string().min(1)]),
    domain: z.string().optional(),
    dryRun: z.boolean().optional(),
    limit: z.union([z.number().int().positive(), z.string().min(1)]).optional()
});

export function createMaintenanceRouter(config) {
    const router = express.Router();

    router.get('/storage', asyncHandler(async (req, res) => {
        assertSuperAdmin(req.auth);
        const storage = await getStorageStats(config);
        res.json({
            storage,
            requestId: req.requestId
        });
    }));

    router.post('/prune-raw-mime', asyncHandler(async (req, res) => {
        assertSuperAdmin(req.auth);
        const result = await pruneStoredRawMime(config);
        res.json({
            success: true,
            ...result,
            requestId: req.requestId
        });
    }));

    router.post('/prune-emails', asyncHandler(async (req, res) => {
        assertSuperAdmin(req.auth);
        const payload = pruneEmailsSchema.parse(req.body ?? {});
        const result = await pruneEmails(config, {
            olderThanDays: payload.olderThanDays,
            domain: payload.domain,
            dryRun: payload.dryRun === true,
            limit: payload.limit
        });
        res.json({
            success: true,
            ...result,
            requestId: req.requestId
        });
    }));

    return router;
}
