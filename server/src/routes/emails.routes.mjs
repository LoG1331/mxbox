import express from 'express';
import { z } from 'zod';
import { ensureDomainPermission, ensureMailboxPermission, hasGlobalPermission } from '../services/account-service.mjs';
import { asyncHandler } from '../utils/async-handler.mjs';
import { parseEmailAddress } from '../utils/email.mjs';
import { HttpError, parsePagination } from '../utils/http.mjs';
import {
    deleteEmailsByIds,
    deleteEmailById,
    deleteEmailsByRecipient,
    assertRegisteredMailboxPermission,
    getAuthorizedEmailsByIds,
    getInboxByAddress,
    listEmails
} from '../services/email-service.mjs';

const emailDeleteBatchSchema = z.object({
    emailIds: z.array(z.union([z.number().int().positive(), z.string().min(1)])).min(1).max(200)
});

export function createEmailsRouter(config) {
    const router = express.Router();

    router.get('/', asyncHandler(async (req, res) => {
        const requestedDomain = req.query.domain ? String(req.query.domain) : '';
        const requestedAddress = req.query.address ? String(req.query.address) : '';
        const requestedScope = req.query.scope ? String(req.query.scope) : '';
        const requestedSearch = req.query.search ? String(req.query.search) : '';

        if (requestedScope && requestedScope !== 'registered' && requestedScope !== 'system') {
            throw new HttpError(400, 'Invalid scope filter');
        }

        if (requestedScope === 'system' && !hasGlobalPermission(req.auth)) {
            throw new HttpError(403, 'System scope is only available to admins');
        }

        if (requestedDomain && requestedAddress) {
            const parsedAddress = parseEmailAddress(requestedAddress);
            if (!parsedAddress) {
                throw new HttpError(400, 'Invalid email address filter');
            }

            if (parsedAddress.domain !== requestedDomain.toLowerCase()) {
                throw new HttpError(400, 'address domain does not match domain filter');
            }
        }

        if (hasGlobalPermission(req.auth)) {
            if (requestedAddress) {
                await ensureMailboxPermission(config, req.auth, requestedAddress, 'view');
            } else if (requestedDomain) {
                await ensureDomainPermission(config, req.auth, requestedDomain, 'view');
            }
        }

        const result = await listEmails(config, {
            ...req.auth,
        }, {
            limit: parsePagination(req.query.limit, 50, { min: 1, max: 200 }),
            cursor: req.query.cursor ? String(req.query.cursor) : '',
            domain: requestedDomain,
            address: requestedAddress,
            search: requestedSearch,
            scope: requestedScope
        });

        res.json({
            count: result.count,
            emails: result.emails,
            nextCursor: result.nextCursor,
            hasMore: result.hasMore,
            requestId: req.requestId
        });
    }));

    router.post('/bulk-delete', asyncHandler(async (req, res) => {
        const payload = emailDeleteBatchSchema.parse(req.body);
        const lookup = await getAuthorizedEmailsByIds(config, req.auth, payload.emailIds, {
            permission: 'write'
        });
        const deletableEmailIds = lookup.emails.map(email => email.id);
        const result = deletableEmailIds.length
            ? await deleteEmailsByIds(config, deletableEmailIds)
            : { success: true, deleted: 0 };

        res.json({
            ...result,
            requestedCount: payload.emailIds.length,
            deletedIds: deletableEmailIds,
            missingIds: lookup.missingIds,
            deniedIds: lookup.deniedIds,
            requestId: req.requestId
        });
    }));

    router.get('/:id', asyncHandler(async (req, res) => {
        const result = await getAuthorizedEmailsByIds(config, req.auth, [req.params.id], {
            includeRawMime: req.query.includeRawMime === '1'
        });

        if (result.missingIds.length) {
            throw new HttpError(404, 'Email not found');
        }

        if (result.deniedIds.length) {
            throw new HttpError(403, 'Email is not available for this user');
        }

        res.json({
            email: result.emails[0],
            requestId: req.requestId
        });
    }));

    router.delete('/:id', asyncHandler(async (req, res) => {
        const lookup = await getAuthorizedEmailsByIds(config, req.auth, [req.params.id], {
            permission: 'write'
        });

        if (lookup.missingIds.length) {
            throw new HttpError(404, 'Email not found');
        }

        if (lookup.deniedIds.length) {
            throw new HttpError(403, 'Email is not available for this user');
        }

        const result = await deleteEmailById(config, req.params.id);
        res.json({
            ...result,
            requestId: req.requestId
        });
    }));

    return router;
}

export function createInboxesRouter(config) {
    const router = express.Router();

    router.get('/:emailAddress', asyncHandler(async (req, res) => {
        const emailAddress = decodeURIComponent(req.params.emailAddress);
        const parsedAddress = parseEmailAddress(emailAddress);
        if (!parsedAddress) {
            throw new HttpError(400, 'Invalid email address');
        }

        await assertRegisteredMailboxPermission(config, req.auth, parsedAddress.email, 'view');
        const result = await getInboxByAddress(
            config,
            emailAddress,
            {
                limit: parsePagination(req.query.limit, 50, { min: 1, max: 200 }),
                cursor: req.query.cursor ? String(req.query.cursor) : '',
                stime: req.query.stime ? String(req.query.stime) : ''
            }
        );

        res.json({
            emailAddress,
            count: result.count,
            emails: result.emails,
            nextCursor: result.nextCursor,
            hasMore: result.hasMore,
            requestId: req.requestId
        });
    }));

    router.delete('/:emailAddress', asyncHandler(async (req, res) => {
        const emailAddress = decodeURIComponent(req.params.emailAddress);
        const parsedAddress = parseEmailAddress(emailAddress);
        if (!parsedAddress) {
            throw new HttpError(400, 'Invalid email address');
        }

        await assertRegisteredMailboxPermission(config, req.auth, parsedAddress.email, 'write');
        const result = await deleteEmailsByRecipient(config, emailAddress);
        res.json({
            ...result,
            requestId: req.requestId
        });
    }));

    return router;
}
