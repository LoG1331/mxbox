export class HttpError extends Error {
    constructor(status, message, details = null) {
        super(message);
        this.name = 'HttpError';
        this.status = status;
        this.details = details;
    }
}

export function parsePagination(value, fallback, { min = 0, max = 200 } = {}) {
    const parsed = Number.parseInt(String(value ?? ''), 10);
    if (!Number.isFinite(parsed)) {
        return fallback;
    }

    return Math.min(max, Math.max(min, parsed));
}

