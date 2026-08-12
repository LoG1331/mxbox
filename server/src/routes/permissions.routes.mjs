import express from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/async-handler.mjs';
import {
    assertSuperAdmin,
    createPermission,
    deletePermission,
    getPermissionById,
    listPermissions
} from '../services/account-service.mjs';
import { parsePagination } from '../utils/http.mjs';

const permissionCreateSchema = z.object({
    userId: z.union([z.number().int().positive(), z.string().min(1)]).optional(),
    username: z.string().min(1).optional(),
    displayName: z.string().optional(),
    telegramId: z.union([z.string(), z.null()]).optional(),
    domain: z.string().min(1)
}).refine(payload => payload.userId !== undefined || payload.username !== undefined, {
    message: 'userId or username is required'
});

export function createPermissionsRouter(config) {
    const router = express.Router();

    router.get('/', asyncHandler(async (req, res) => {
        assertSuperAdmin(req.auth);
        const result = await listPermissions(config, {
            userId: req.query.userId ? String(req.query.userId) : '',
            username: req.query.username ? String(req.query.username) : '',
            domain: req.query.domain ? String(req.query.domain) : '',
            status: req.query.status ? String(req.query.status) : ''
        }, {
            limit: parsePagination(req.query.limit, 50, { min: 1, max: 200 }),
            offset: parsePagination(req.query.offset, 0, { min: 0, max: 100000 })
        });
        res.json({
            total: result.total,
            count: result.permissions.length,
            permissions: result.permissions,
            requestId: req.requestId
        });
    }));

    router.post('/', asyncHandler(async (req, res) => {
        assertSuperAdmin(req.auth);
        const payload = permissionCreateSchema.parse(req.body);
        const permission = await createPermission(config, payload, req.auth);
        res.status(201).json({
            success: true,
            permission,
            requestId: req.requestId
        });
    }));

    router.get('/:permissionId', asyncHandler(async (req, res) => {
        assertSuperAdmin(req.auth);
        const permission = await getPermissionById(config, req.params.permissionId);
        res.json({
            permission,
            requestId: req.requestId
        });
    }));

    router.delete('/:permissionId', asyncHandler(async (req, res) => {
        assertSuperAdmin(req.auth);
        const result = await deletePermission(config, req.params.permissionId);
        res.json({
            ...result,
            requestId: req.requestId
        });
    }));

    return router;
}
