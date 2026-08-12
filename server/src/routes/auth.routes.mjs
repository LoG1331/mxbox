import express from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/async-handler.mjs';
import {
    changeOwnPassword,
    getCurrentAccountProfile,
    listAccessibleDomains,
    loginUser,
    logoutSession,
    refreshSession,
    rotateOwnApiKey,
    updateOwnProfile
} from '../services/account-service.mjs';

const loginSchema = z.object({
    username: z.string().min(1),
    password: z.string().min(1)
});

const updateMeSchema = z.object({
    displayName: z.string().optional(),
    telegramId: z.union([z.string(), z.null()]).optional()
});

const passwordSchema = z.object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8)
});

const rotateApiKeySchema = z.object({
    apiKey: z.string().min(16).optional()
});

export function createAuthRouter(config, userAuth) {
    const router = express.Router();

    router.post('/login', asyncHandler(async (req, res) => {
        const payload = loginSchema.parse(req.body);
        const result = await loginUser(config, payload, {
            ipAddress: req.ip,
            userAgent: req.header('user-agent') || ''
        });

        res.json({
            success: true,
            tokenType: 'Bearer',
            sessionToken: result.sessionToken,
            expiresAt: result.expiresAt,
            session: result.session,
            account: result.account,
            requestId: req.requestId
        });
    }));

    router.use(userAuth);

    router.post('/logout', asyncHandler(async (req, res) => {
        const result = req.auth?.mode === 'session'
            ? await logoutSession(config, req.auth)
            : { success: true };

        res.json({
            ...result,
            requestId: req.requestId
        });
    }));

    router.post('/refresh', asyncHandler(async (req, res) => {
        const result = await refreshSession(config, req.auth);
        res.json({
            success: true,
            tokenType: 'Bearer',
            sessionToken: result.sessionToken,
            expiresAt: result.expiresAt,
            requestId: req.requestId
        });
    }));

    router.get('/me', asyncHandler(async (req, res) => {
        const account = await getCurrentAccountProfile(config, req.auth);
        const accessibleDomains = await listAccessibleDomains(config, req.auth);
        res.json({
            account,
            accessibleDomains,
            requestId: req.requestId
        });
    }));

    router.patch('/me', asyncHandler(async (req, res) => {
        const payload = updateMeSchema.parse(req.body);
        const account = await updateOwnProfile(config, req.auth, payload);
        res.json({
            success: true,
            account,
            requestId: req.requestId
        });
    }));

    router.post('/me/password', asyncHandler(async (req, res) => {
        const payload = passwordSchema.parse(req.body);
        const result = await changeOwnPassword(config, req.auth, payload);
        res.json({
            ...result,
            requestId: req.requestId
        });
    }));

    router.post('/me/api-key/rotate', asyncHandler(async (req, res) => {
        const payload = rotateApiKeySchema.parse(req.body ?? {});
        const result = await rotateOwnApiKey(config, req.auth, payload);
        res.json({
            success: true,
            user: result.user,
            apiKey: result.apiKey,
            requestId: req.requestId
        });
    }));

    return router;
}
