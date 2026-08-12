import { timingSafeEqual } from 'node:crypto';
import { getApiKeyContext, getSessionContext, touchSession } from '../services/account-service.mjs';

function extractAuthorization(req) {
    const authorization = req.header('authorization') || '';
    const [scheme, token] = authorization.split(/\s+/, 2);
    return {
        scheme: scheme ? scheme.toLowerCase() : '',
        token: token || ''
    };
}

function safeEqual(left, right) {
    if (!left || !right) {
        return false;
    }

    const leftBuffer = Buffer.from(left);
    const rightBuffer = Buffer.from(right);
    if (leftBuffer.length !== rightBuffer.length) {
        return false;
    }

    return timingSafeEqual(leftBuffer, rightBuffer);
}

export function createBearerAuth(expectedToken, scope) {
    return function bearerAuth(req, res, next) {
        const { scheme, token } = extractAuthorization(req);
        if (scheme !== 'bearer' || !safeEqual(token, expectedToken)) {
            return res.status(401).json({
                error: 'Unauthorized',
                scope,
                requestId: req.requestId
            });
        }

        return next();
    };
}

export function createUserAuth(config) {
    return async function userAuth(req, res, next) {
        try {
            const xApiKey = String(req.header('x-api-key') || '').trim();
            if (xApiKey) {
                const apiKeyContext = await getApiKeyContext(config, xApiKey);
                if (!apiKeyContext) {
                    return res.status(401).json({
                        error: 'Unauthorized',
                        scope: 'user',
                        requestId: req.requestId
                    });
                }

                req.auth = apiKeyContext;
                return next();
            }

            const { scheme, token } = extractAuthorization(req);
            if (scheme === 'apikey') {
                const apiKeyContext = await getApiKeyContext(config, token);
                if (!apiKeyContext) {
                    return res.status(401).json({
                        error: 'Unauthorized',
                        scope: 'user',
                        requestId: req.requestId
                    });
                }

                req.auth = apiKeyContext;
                return next();
            }

            if (scheme !== 'bearer') {
                return res.status(401).json({
                    error: 'Unauthorized',
                    scope: 'user',
                    requestId: req.requestId
                });
            }

            const sessionContext = await getSessionContext(config, token);
            if (!sessionContext) {
                return res.status(401).json({
                    error: 'Unauthorized',
                    scope: 'user',
                    requestId: req.requestId
                });
            }

            req.auth = sessionContext.account;
            req.session = sessionContext.session;

            const lastSeenAt = Date.parse(sessionContext.session.lastSeenAt || 0);
            if (!Number.isFinite(lastSeenAt) || Date.now() - lastSeenAt >= config.sessionTouchIntervalMs) {
                void touchSession(config, sessionContext.session.id).catch(error => {
                    console.error('Failed to touch user session:', error);
                });
            }

            return next();
        } catch (error) {
            return next(error);
        }
    };
}
