import express from 'express';
import { z } from 'zod';
import { asyncHandler } from '../utils/async-handler.mjs';
import { isValidDomain } from '../utils/email.mjs';
import { parsePagination } from '../utils/http.mjs';
import {
    assertSuperAdmin,
    ensureDomainPermission,
    hasGlobalPermission,
    listAccessibleDomains
} from '../services/account-service.mjs';
import {
    createDomain,
    deleteDomain,
    getDomain,
    listDomains
} from '../services/domain-service.mjs';

const domainSchema = z.string().trim().min(1).refine(value => isValidDomain(value), {
    message: 'Invalid domain format'
});

const domainCreateSchema = z.object({
    domain: domainSchema,
    description: z.string().optional(),
    isDefault: z.boolean().optional()
});

export function createDomainsRouter(config) {
    const router = express.Router();

    router.get('/', asyncHandler(async (req, res) => {
        let allowedDomains = null;
        if (!hasGlobalPermission(req.auth)) {
            allowedDomains = await listAccessibleDomains(config, req.auth, {
                domainLevelOnly: true
            });
        }

        const result = await listDomains(config, {
            allowedDomains,
            limit: parsePagination(req.query.limit, 50, { min: 1, max: 200 }),
            offset: parsePagination(req.query.offset, 0, { min: 0, max: 100000 })
        });

        res.json({
            total: result.total,
            count: result.domains.length,
            domains: result.domains,
            requestId: req.requestId
        });
    }));

    router.post('/', asyncHandler(async (req, res) => {
        assertSuperAdmin(req.auth);
        const payload = domainCreateSchema.parse(req.body);
        const domain = await createDomain(config, payload);
        res.status(201).json({
            success: true,
            domain,
            requestId: req.requestId
        });
    }));

    router.get('/:domain', asyncHandler(async (req, res) => {
        await ensureDomainPermission(config, req.auth, req.params.domain, 'view');
        const domain = await getDomain(config, req.params.domain);
        res.json({
            domain,
            requestId: req.requestId
        });
    }));

    router.delete('/:domain', asyncHandler(async (req, res) => {
        assertSuperAdmin(req.auth);
        const result = await deleteDomain(config, req.params.domain);
        res.json({
            ...result,
            requestId: req.requestId
        });
    }));

    return router;
}
