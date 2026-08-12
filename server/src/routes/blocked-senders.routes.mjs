import express from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/async-handler.mjs';
import { assertSuperAdmin } from '../services/account-service.mjs';
import { parsePagination } from '../utils/http.mjs';
import {
    createBlockedSender,
    deleteBlockedSender,
    getBlockedSenderById,
    listBlockedSenders,
    updateBlockedSender
} from '../services/blocked-sender-service.mjs';

const patternTypeSchema = z.enum(['email', 'domain']);
const statusSchema = z.enum(['active', 'disabled']);

const blockedSenderCreateSchema = z.object({
    pattern: z.string().trim().min(1),
    patternType: patternTypeSchema.optional(),
    domain: z.union([z.string(), z.null()]).optional(),
    reason: z.string().optional(),
    status: statusSchema.optional()
});

const blockedSenderUpdateSchema = z.object({
    pattern: z.string().trim().min(1).optional(),
    patternType: patternTypeSchema.optional(),
    domain: z.union([z.string(), z.null()]).optional(),
    reason: z.string().optional(),
    status: statusSchema.optional()
});

export function createBlockedSendersRouter(config) {
    const router = express.Router();

    router.get('/', asyncHandler(async (req, res) => {
        assertSuperAdmin(req.auth);
        const result = await listBlockedSenders(config, {
            patternType: req.query.patternType ? String(req.query.patternType) : '',
            status: req.query.status ? String(req.query.status) : '',
            domain: req.query.domain ? String(req.query.domain) : '',
            scope: req.query.scope ? String(req.query.scope) : '',
            q: req.query.q ? String(req.query.q) : ''
        }, {
            limit: parsePagination(req.query.limit, 50, { min: 1, max: 200 }),
            offset: parsePagination(req.query.offset, 0, { min: 0, max: 100000 })
        });

        res.json({
            total: result.total,
            count: result.blockedSenders.length,
            blockedSenders: result.blockedSenders,
            requestId: req.requestId
        });
    }));

    router.post('/', asyncHandler(async (req, res) => {
        assertSuperAdmin(req.auth);
        const payload = blockedSenderCreateSchema.parse(req.body ?? {});
        const blockedSender = await createBlockedSender(config, payload, req.auth);
        res.status(201).json({
            success: true,
            blockedSender,
            requestId: req.requestId
        });
    }));

    router.get('/:blockedSenderId', asyncHandler(async (req, res) => {
        assertSuperAdmin(req.auth);
        const blockedSender = await getBlockedSenderById(config, req.params.blockedSenderId);
        res.json({
            blockedSender,
            requestId: req.requestId
        });
    }));

    router.patch('/:blockedSenderId', asyncHandler(async (req, res) => {
        assertSuperAdmin(req.auth);
        const payload = blockedSenderUpdateSchema.parse(req.body ?? {});
        const blockedSender = await updateBlockedSender(config, req.params.blockedSenderId, payload);
        res.json({
            success: true,
            blockedSender,
            requestId: req.requestId
        });
    }));

    router.delete('/:blockedSenderId', asyncHandler(async (req, res) => {
        assertSuperAdmin(req.auth);
        const result = await deleteBlockedSender(config, req.params.blockedSenderId);
        res.json({
            ...result,
            requestId: req.requestId
        });
    }));

    return router;
}
