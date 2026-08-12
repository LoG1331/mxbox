import express from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/async-handler.mjs';
import {
    createRandomEmailRegister,
    createEmailRegister,
    deleteEmailRegister,
    listEmailRegisters
} from '../services/email-register-service.mjs';
import { parsePagination } from '../utils/http.mjs';

const createEmailRegisterSchema = z.object({
    emailAddress: z.string().min(1),
    ownerUserId: z.union([z.number().int().positive(), z.string().min(1)]).optional()
});
const createRandomEmailRegisterQuerySchema = z.object({
    domain: z.string().min(1).optional(),
    ownerUserId: z.union([z.number().int().positive(), z.string().min(1)]).optional()
});

export function createEmailRegistersRouter(config) {
    const router = express.Router();

    router.get('/', asyncHandler(async (req, res) => {
        const result = await listEmailRegisters(config, req.auth, {
            ownerUserId: req.query.ownerUserId ? String(req.query.ownerUserId) : '',
            search: typeof req.query.search === 'string' ? req.query.search.trim().slice(0, 200) : ''
        }, {
            limit: parsePagination(req.query.limit, 50, { min: 1, max: 200 }),
            offset: parsePagination(req.query.offset, 0, { min: 0, max: 100000 })
        });

        res.json({
            total: result.total,
            count: result.registrations.length,
            registrations: result.registrations,
            requestId: req.requestId
        });
    }));

    router.get('/new-mail', asyncHandler(async (req, res) => {
        const query = createRandomEmailRegisterQuerySchema.parse(req.query ?? {});
        const registration = await createRandomEmailRegister(config, req.auth, query);
        res.set('Cache-Control', 'no-store');
        res.json({
            success: true,
            registration,
            requestId: req.requestId
        });
    }));

    router.post('/', asyncHandler(async (req, res) => {
        const payload = createEmailRegisterSchema.parse(req.body);
        const registration = await createEmailRegister(config, req.auth, payload);
        res.status(201).json({
            success: true,
            registration,
            requestId: req.requestId
        });
    }));

    router.delete('/:registrationId', asyncHandler(async (req, res) => {
        const result = await deleteEmailRegister(config, req.auth, req.params.registrationId);
        res.json({
            ...result,
            requestId: req.requestId
        });
    }));

    return router;
}
