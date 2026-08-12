import express from 'express';
import PostalMime from 'postal-mime';
import { asyncHandler } from '../utils/async-handler.mjs';
import { ingestInboundEmail } from '../services/email-service.mjs';

function sanitizeHeader(value) {
    return String(value || '').replace(/[\r\n]+/g, ' ').trim();
}

function firstAddress(value) {
    if (!value) {
        return '';
    }

    if (typeof value === 'string') {
        return value;
    }

    if (Array.isArray(value)) {
        for (const item of value) {
            const address = firstAddress(item);
            if (address) {
                return address;
            }
        }
        return '';
    }

    if (value.address) {
        return value.address;
    }

    if (Array.isArray(value.value)) {
        return firstAddress(value.value);
    }

    return '';
}

function parseSender(sender) {
    if (!sender) {
        return null;
    }

    if (Array.isArray(sender)) {
        return parseSender(sender[0]);
    }

    if (sender.address || sender.name) {
        return {
            name: sender.name || null,
            address: sender.address || null
        };
    }

    if (Array.isArray(sender.value)) {
        return parseSender(sender.value[0]);
    }

    return null;
}

export function createInboundRouter(config) {
    const router = express.Router();

    router.post(
        '/email',
        express.raw({
            type: () => true,
            limit: config.maxEmailSizeBytes
        }),
        asyncHandler(async (req, res) => {
            const rawMime = Buffer.isBuffer(req.body) ? req.body : Buffer.from(req.body || '');
            const parsedEmail = await new PostalMime().parse(rawMime);
            const result = await ingestInboundEmail(config, {
                envelopeTo: sanitizeHeader(req.header('x-email-envelope-to')) || firstAddress(parsedEmail.to),
                envelopeFrom: sanitizeHeader(req.header('x-email-envelope-from')) || firstAddress(parsedEmail.from),
                receivedAt: sanitizeHeader(req.header('x-email-received-at')),
                workerName: sanitizeHeader(req.header('x-email-worker-name')),
                sourceDomain: sanitizeHeader(req.header('x-email-domain')),
                messageId: sanitizeHeader(req.header('x-email-message-id')) || cleanMessageId(parsedEmail.messageId),
                senderJson: parseSender(parsedEmail.from),
                subject: parsedEmail.subject || '(No Subject)',
                textBody: parsedEmail.text || '',
                htmlBody: parsedEmail.html || '',
                rawMime
            });

            // Blocked senders still get 202 so the worker treats the message as
            // delivered and does not retry or bounce it back to the sender.
            res.status(202).json({
                success: true,
                ...result,
                requestId: req.requestId
            });
        })
    );

    return router;
}

function cleanMessageId(value) {
    return String(value || '').replace(/[<>]/g, '').trim();
}
