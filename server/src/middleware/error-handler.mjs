import { ZodError } from 'zod';
import { HttpError } from '../utils/http.mjs';

export function notFoundHandler(req, res) {
    res.status(404).json({
        error: 'Not found',
        path: req.originalUrl,
        requestId: req.requestId
    });
}

export function errorHandler(error, req, res, next) {
    if (res.headersSent) {
        return next(error);
    }

    if (error instanceof ZodError) {
        return res.status(400).json({
            error: 'Validation failed',
            details: error.issues,
            requestId: req.requestId
        });
    }

    if (error?.type === 'entity.too.large') {
        return res.status(413).json({
            error: 'Request body too large',
            requestId: req.requestId
        });
    }

    if (error instanceof HttpError) {
        return res.status(error.status).json({
            error: error.message,
            details: error.details || undefined,
            requestId: req.requestId
        });
    }

    console.error(`[${req.requestId}]`, error);
    return res.status(500).json({
        error: 'Internal server error',
        requestId: req.requestId
    });
}

