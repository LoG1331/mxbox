export function cn(...values) {
  return values.filter(Boolean).join(' ')
}

export function formatDateTime(value) {
  if (!value) {
    return 'N/A'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  return new Intl.DateTimeFormat('en-US', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(date)
}

export function formatRelativeTime(value) {
  if (!value) {
    return 'N/A'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return value
  }

  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000))

  if (seconds < 60) {
    return 'just now'
  }

  const minutes = Math.round(seconds / 60)
  if (minutes < 60) {
    return `${minutes} m ago`
  }

  const hours = Math.round(minutes / 60)
  if (hours < 24) {
    return `${hours} h ago`
  }

  const days = Math.round(hours / 24)
  return `${days} d ago`
}

export function formatBytes(value) {
  const bytes = Number(value)
  if (!Number.isFinite(bytes) || bytes < 0) {
    return 'N/A'
  }

  if (bytes < 1024) {
    return `${bytes} B`
  }

  const units = ['KB', 'MB', 'GB', 'TB']
  let size = bytes / 1024
  let unitIndex = 0

  while (size >= 1024 && unitIndex < units.length - 1) {
    size /= 1024
    unitIndex += 1
  }

  const maximumFractionDigits = size >= 100 ? 0 : size >= 10 ? 1 : 2
  return `${size.toLocaleString('en-US', {
    minimumFractionDigits: 0,
    maximumFractionDigits,
  })} ${units[unitIndex]}`
}

export function parseIdList(value) {
  return String(value || '')
    .split(/[\s,;]+/)
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => Number.parseInt(item, 10))
    .filter((item) => Number.isInteger(item) && item > 0)
}

export function normalizeOptional(value) {
  const text = String(value ?? '').trim()
  return text || null
}

const FIELD_LABELS = {
  apiKey: 'API key',
  color: 'Color',
  currentPassword: 'Current password',
  description: 'Description',
  displayName: 'Display name',
  domain: 'Domain',
  emailAddress: 'Email address',
  emailAddresses: 'Email addresses',
  emailIds: 'Emails',
  inboundEnabled: 'Inbound',
  isDefault: 'Default',
  limit: 'Limit',
  name: 'Name',
  newPassword: 'New password',
  olderThanDays: 'Days',
  ownerUserId: 'Owner',
  password: 'Password',
  pattern: 'Sender',
  patternType: 'Block type',
  publicBaseUrl: 'Public base URL',
  reason: 'Reason',
  status: 'Status',
  telegramId: 'Telegram ID',
  userId: 'User',
  username: 'Username',
}

function fieldLabel(path) {
  const key = Array.isArray(path) ? path.find((part) => typeof part === 'string') : path
  if (!key) {
    return ''
  }

  return FIELD_LABELS[key] || key
}

/**
 * Zod emits technical English messages ("Too small: expected string to have
 * >=8 characters"). Rewrite the common shapes into short user-facing text and
 * keep the rest as-is because backend-set messages (HttpError) are usually
 * clear enough.
 */
function humanizeIssueMessage(message, issue) {
  const raw = String(message || '').trim()

  if (issue?.code === 'invalid_type' && /received undefined|received null/i.test(raw)) {
    return 'Required'
  }

  const tooSmall = raw.match(/expected \w+ to have >=(\d+) characters?/i)
  if (tooSmall) {
    return `Must be at least ${tooSmall[1]} characters`
  }

  const tooBig = raw.match(/expected \w+ to have <=(\d+) characters?/i)
  if (tooBig) {
    return `Must be at most ${tooBig[1]} characters`
  }

  if (/expected array to have >=(\d+)/i.test(raw)) {
    return 'Select at least one item'
  }

  return raw
}

/**
 * The backend returns `details` as an array of Zod issues for 400 errors, or
 * a context-dependent object. Normalize to a list of { field, label, message }
 * so forms can render them inline.
 */
export function getApiErrorIssues(error) {
  const details = error?.details
  if (!details) {
    return []
  }

  if (Array.isArray(details)) {
    return details
      .map((issue) => {
        const message = String(issue?.message || '').trim()
        if (!message) {
          return null
        }

        const path = issue?.path
        const key = Array.isArray(path) ? path.find((part) => typeof part === 'string') : path

        return {
          field: key || '',
          label: fieldLabel(path),
          message: humanizeIssueMessage(message, issue),
        }
      })
      .filter(Boolean)
  }

  if (typeof details === 'object') {
    return Object.entries(details)
      .filter(([, value]) => value !== null && value !== undefined && typeof value !== 'object')
      .map(([key, value]) => ({
        field: key,
        label: fieldLabel(key),
        message: String(value),
      }))
  }

  return []
}

/**
 * Get the error message for a specific field to render under the input.
 * `fields` may hold multiple names when the backend accepts different ways of
 * entering the same thing.
 */
export function findIssueMessage(error, fields) {
  const wanted = Array.isArray(fields) ? fields : [fields]
  const issue = getApiErrorIssues(error).find((item) => wanted.includes(item.field))
  return issue?.message || ''
}

export function formatApiError(error) {
  if (!error) {
    return 'Unknown error'
  }

  if (!error.message) {
    return String(error)
  }

  const issues = getApiErrorIssues(error)
  const summary = issues.length
    ? `${error.message}: ${issues
      .slice(0, 3)
      .map((issue) => (issue.label ? `${issue.label} — ${issue.message}` : issue.message))
      .join('; ')}${issues.length > 3 ? `; +${issues.length - 3} more` : ''}`
    : error.message

  return error.requestId ? `${summary} · ${error.requestId}` : summary
}

export function getPermissionScopeLabel(permission) {
  if (!permission) {
    return ''
  }

  return permission.domain || ''
}

export function truncate(value, maxLength = 120) {
  const text = String(value || '')
  if (text.length <= maxLength) {
    return text
  }

  return `${text.slice(0, maxLength)}…`
}
