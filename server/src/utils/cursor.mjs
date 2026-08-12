import { HttpError } from './http.mjs';

export function encodeCursor(payload) {
    return Buffer.from(JSON.stringify(payload)).toString('base64url');
}

export function decodeCursor(value, errorMessage = 'Invalid cursor') {
    try {
        const decoded = Buffer.from(String(value || ''), 'base64url').toString('utf8');
        return JSON.parse(decoded);
    } catch {
        throw new HttpError(400, errorMessage);
    }
}
