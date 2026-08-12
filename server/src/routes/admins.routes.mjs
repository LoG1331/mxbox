import express from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/async-handler.mjs';
import {
    assertSuperAdmin,
    grantAdmin,
    listAdmins,
    revokeAdmin
} from '../services/account-service.mjs';
import { parsePagination } from '../utils/http.mjs';

const adminMutationSchema = z.object({
    userId: z.union([z.number().int().positive(), z.string().min(1)]).optional(),
    username: z.string().min(1).optional()
}).refine(payload => payload.userId !== undefined || payload.username !== undefined, {
    message: 'userId or username is required'
});

export function createAdminsRouter(config) {
    const router = express.Router();

    router.get('/', asyncHandler(async (req, res) => {
        assertSuperAdmin(req.auth);
        const result = await listAdmins(config, {
            q: req.query.q ? String(req.query.q) : '',
            limit: parsePagination(req.query.limit, 50, { min: 1, max: 200 }),
            offset: parsePagination(req.query.offset, 0, { min: 0, max: 100000 })
        });
        res.json({
            total: result.total,
            count: result.admins.length,
            admins: result.admins,
            requestId: req.requestId
        });
    }));

    router.post('/', asyncHandler(async (req, res) => {
        assertSuperAdmin(req.auth);
        const payload = adminMutationSchema.parse(req.body);
        const admin = await grantAdmin(config, payload, req.auth);
        res.status(201).json({
            success: true,
            admin,
            requestId: req.requestId
        });
    }));

    router.delete('/:userId', asyncHandler(async (req, res) => {
        assertSuperAdmin(req.auth);
        const result = await revokeAdmin(config, req.params.userId);
        res.json({
            ...result,
            requestId: req.requestId
        });
    }));

    return router;
}
