function normalizeText(value) {
    return String(value || '').trim().toLowerCase();
}

const DOMAIN_REGEX = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;

export function isValidDomain(value) {
    const normalized = normalizeText(value);
    return DOMAIN_REGEX.test(normalized);
}

export function normalizeDomain(value) {
    const normalized = normalizeText(value);
    if (!isValidDomain(normalized)) {
        return '';
    }

    return normalized;
}

export function normalizeLocalPart(value) {
    const normalized = normalizeText(value);
    if (!normalized || normalized.includes('@') || normalized.startsWith('.')) {
        return '';
    }

    return normalized;
}

export function buildEmailAddress(localPart, domain) {
    const normalizedLocalPart = normalizeLocalPart(localPart);
    const normalizedDomain = normalizeDomain(domain);
    if (!normalizedLocalPart || !normalizedDomain) {
        return '';
    }

    return `${normalizedLocalPart}@${normalizedDomain}`;
}

export function parseEmailAddress(value) {
    const normalized = normalizeText(value);
    const atIndex = normalized.indexOf('@');
    if (!normalized || atIndex <= 0 || atIndex === normalized.length - 1) {
        return null;
    }

    const localPart = normalizeLocalPart(normalized.slice(0, atIndex));
    const domain = normalizeDomain(normalized.slice(atIndex + 1));
    if (!localPart || !domain) {
        return null;
    }

    return {
        email: `${localPart}@${domain}`,
        localPart,
        domain
    };
}

export function parseEnvelopeAddress(value) {
    return parseEmailAddress(value);
}

// 'a.b.example.com' -> ['a.b.example.com', 'b.example.com', 'example.com']
// Used for wildcard subdomain matching: a registered domain receives mail
// for all of its subdomains; the first existing ancestor wins (longest match).
// Stops at two labels — never walks up to the TLD.
export function domainAncestors(domain) {
    const normalized = normalizeDomain(domain);
    if (!normalized) {
        return [];
    }

    const labels = normalized.split('.');
    const ancestors = [];
    for (let i = 0; labels.length - i >= 2; i += 1) {
        ancestors.push(labels.slice(i).join('.'));
    }

    return ancestors;
}
