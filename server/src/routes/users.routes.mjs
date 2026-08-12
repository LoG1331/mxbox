import express from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/async-handler.mjs';
import {
    assertSuperAdmin,
    createUser,
    getUserById,
    listUsers,
    rotateUserApiKey,
    updateUser
} from '../services/account-service.mjs';
import { parsePagination } from '../utils/http.mjs';

const createUserSchema = z.object({
    username: z.string().min(3),
    password: z.string().min(8),
    displayName: z.string().optional(),
    telegramId: z.union([z.string(), z.null()]).optional(),
    generateApiKey: z.boolean().optional(),
    apiKey: z.string().min(16).optional()
});

const updateUserSchema = z.object({
    username: z.string().min(3).optional(),
    password: z.string().min(8).optional(),
    displayName: z.string().optional(),
    telegramId: z.union([z.string(), z.null()]).optional(),
    status: z.enum(['active', 'disabled']).optional()
});

const rotateApiKeySchema = z.object({
    apiKey: z.string().min(16).optional()
});

export function createUsersRouter(config) {
    const router = express.Router();

    router.get('/', asyncHandler(async (req, res) => {
        assertSuperAdmin(req.auth);
        const result = await listUsers(config, {
            q: req.query.q ? String(req.query.q) : '',
            telegramId: req.query.telegramId ? String(req.query.telegramId) : '',
            limit: parsePagination(req.query.limit, 50, { min: 1, max: 200 }),
            offset: parsePagination(req.query.offset, 0, { min: 0, max: 100000 })
        });
        res.json({
            total: result.total,
            count: result.users.length,
            users: result.users,
            requestId: req.requestId
        });
    }));

    router.post('/', asyncHandler(async (req, res) => {
        assertSuperAdmin(req.auth);
        const payload = createUserSchema.parse(req.body);
        const result = await createUser(config, payload);
        res.status(201).json({
            success: true,
            user: result.user,
            apiKey: result.apiKey,
            requestId: req.requestId
        });
    }));

    router.get('/:userId', asyncHandler(async (req, res) => {
        assertSuperAdmin(req.auth);
        const user = await getUserById(config, req.params.userId);
        res.json({
            user,
            requestId: req.requestId
        });
    }));

    router.patch('/:userId', asyncHandler(async (req, res) => {
        assertSuperAdmin(req.auth);
        const payload = updateUserSchema.parse(req.body);
        const user = await updateUser(config, req.params.userId, payload);
        res.json({
            success: true,
            user,
            requestId: req.requestId
        });
    }));

    router.post('/:userId/api-key/rotate', asyncHandler(async (req, res) => {
        assertSuperAdmin(req.auth);
        const payload = rotateApiKeySchema.parse(req.body ?? {});
        const result = await rotateUserApiKey(config, req.params.userId, payload);
        res.json({
            success: true,
            user: result.user,
            apiKey: result.apiKey,
            requestId: req.requestId
        });
    }));

    return router;
}
