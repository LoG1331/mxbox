const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || ''

export class ApiError extends Error {
  constructor(message, { status = 500, details = null, requestId = null } = {}) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.details = details
    this.requestId = requestId
  }
}

function isPresent(value) {
  return value !== undefined && value !== null && value !== ''
}

function withQuery(path, params = {}) {
  const search = new URLSearchParams()

  Object.entries(params).forEach(([key, value]) => {
    if (!isPresent(value)) {
      return
    }

    search.set(key, String(value))
  })

  const query = search.toString()
  return query ? `${path}?${query}` : path
}

async function parseResponse(response) {
  const text = await response.text()

  if (!text) {
    return null
  }

  try {
    return JSON.parse(text)
  } catch {
    return text
  }
}

async function request(path, { method = 'GET', token, body, headers = {} } = {}) {
  const finalHeaders = new Headers(headers)

  if (token) {
    finalHeaders.set('Authorization', `Bearer ${token}`)
  }

  let requestBody

  if (body !== undefined) {
    finalHeaders.set('Content-Type', 'application/json')
    requestBody = JSON.stringify(body)
  }

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method,
    headers: finalHeaders,
    body: requestBody,
  })

  const payload = await parseResponse(response)

  if (!response.ok) {
    throw new ApiError(
      payload?.error || `Request failed with ${response.status}`,
      {
        status: response.status,
        details: payload?.details ?? null,
        requestId: payload?.requestId ?? null,
      },
    )
  }

  return payload
}

export function getApiBaseUrl() {
  return API_BASE_URL || window.location.origin
}

export function getHealth() {
  return request('/health')
}

export function login(payload) {
  return request('/v1/auth/login', {
    method: 'POST',
    body: payload,
  })
}

export function logout(token) {
  return request('/v1/auth/logout', {
    method: 'POST',
    token,
  })
}

export function refreshSession(token) {
  return request('/v1/auth/refresh', {
    method: 'POST',
    token,
  })
}

export function getMe(token) {
  return request('/v1/auth/me', { token })
}

export function updateMe(token, payload) {
  return request('/v1/auth/me', {
    method: 'PATCH',
    token,
    body: payload,
  })
}

export function changeMyPassword(token, payload) {
  return request('/v1/auth/me/password', {
    method: 'POST',
    token,
    body: payload,
  })
}

export function rotateMyApiKey(token, payload = {}) {
  return request('/v1/auth/me/api-key/rotate', {
    method: 'POST',
    token,
    body: payload,
  })
}

export function listUsers(token, filters = {}) {
  return request(withQuery('/v1/users', filters), { token })
}

export function getUserById(token, userId) {
  return request(`/v1/users/${userId}`, { token })
}

export function createUser(token, payload) {
  return request('/v1/users', {
    method: 'POST',
    token,
    body: payload,
  })
}

export function updateUser(token, userId, payload) {
  return request(`/v1/users/${userId}`, {
    method: 'PATCH',
    token,
    body: payload,
  })
}

export function listAdmins(token, filters = {}) {
  return request(withQuery('/v1/admins', filters), { token })
}

export function grantAdmin(token, payload) {
  return request('/v1/admins', {
    method: 'POST',
    token,
    body: payload,
  })
}

export function revokeAdmin(token, userId) {
  return request(`/v1/admins/${userId}`, {
    method: 'DELETE',
    token,
  })
}

export function listPermissions(token, filters = {}) {
  return request(withQuery('/v1/permissions', filters), { token })
}

export function createPermission(token, payload) {
  return request('/v1/permissions', {
    method: 'POST',
    token,
    body: payload,
  })
}

export function getPermission(token, permissionId) {
  return request(`/v1/permissions/${permissionId}`, { token })
}

export function deletePermission(token, permissionId) {
  return request(`/v1/permissions/${permissionId}`, {
    method: 'DELETE',
    token,
  })
}

export function listDomains(token, filters = {}) {
  return request(withQuery('/v1/domains', filters), { token })
}

export function createDomain(token, payload) {
  return request('/v1/domains', {
    method: 'POST',
    token,
    body: payload,
  })
}

export function getDomain(token, domain) {
  return request(`/v1/domains/${encodeURIComponent(domain)}`, { token })
}

export function deleteDomain(token, domain) {
  return request(`/v1/domains/${encodeURIComponent(domain)}`, {
    method: 'DELETE',
    token,
  })
}

export function listBlockedSenders(token, filters = {}) {
  return request(withQuery('/v1/blocked-senders', filters), { token })
}

export function createBlockedSender(token, payload) {
  return request('/v1/blocked-senders', {
    method: 'POST',
    token,
    body: payload,
  })
}

export function getBlockedSender(token, blockedSenderId) {
  return request(`/v1/blocked-senders/${blockedSenderId}`, { token })
}

export function updateBlockedSender(token, blockedSenderId, payload) {
  return request(`/v1/blocked-senders/${blockedSenderId}`, {
    method: 'PATCH',
    token,
    body: payload,
  })
}

export function deleteBlockedSender(token, blockedSenderId) {
  return request(`/v1/blocked-senders/${blockedSenderId}`, {
    method: 'DELETE',
    token,
  })
}

export function listEmailRegisters(token, filters = {}) {
  return request(withQuery('/v1/email-registers', filters), { token })
}

export function createEmailRegister(token, payload) {
  return request('/v1/email-registers', {
    method: 'POST',
    token,
    body: payload,
  })
}

export function createRandomEmailRegister(token, filters = {}) {
  return request(withQuery('/v1/email-registers/new-mail', filters), { token })
}

export function deleteEmailRegister(token, registrationId) {
  return request(`/v1/email-registers/${registrationId}`, {
    method: 'DELETE',
    token,
  })
}

export function listEmails(token, filters = {}) {
  return request(withQuery('/v1/emails', filters), { token })
}

export function listRegisteredEmails(token, filters = {}) {
  return request(withQuery('/v1/emails', {
    ...filters,
    scope: 'registered',
  }), { token })
}

export function listSystemEmails(token, filters = {}) {
  return request(withQuery('/v1/emails', {
    ...filters,
    scope: 'system',
  }), { token })
}

export function getEmailById(token, id, options = {}) {
  return request(withQuery(`/v1/emails/${id}`, {
    includeRawMime: options.includeRawMime ? 1 : undefined,
  }), { token })
}

export function deleteEmailById(token, id) {
  return request(`/v1/emails/${id}`, {
    method: 'DELETE',
    token,
  })
}

export function deleteEmailsByIds(token, emailIds) {
  return request('/v1/emails/bulk-delete', {
    method: 'POST',
    token,
    body: { emailIds },
  })
}

export function getInboxByAddress(token, emailAddress, options = {}) {
  return request(withQuery(`/v1/inboxes/${encodeURIComponent(emailAddress)}`, {
    limit: options.limit,
    cursor: options.cursor,
    stime: options.stime,
  }), { token })
}

export function clearInbox(token, emailAddress) {
  return request(`/v1/inboxes/${encodeURIComponent(emailAddress)}`, {
    method: 'DELETE',
    token,
  })
}

export function pruneRawMime(token) {
  return request('/v1/maintenance/prune-raw-mime', {
    method: 'POST',
    token,
  })
}

export function getMaintenanceStorage(token) {
  return request('/v1/maintenance/storage', { token })
}

export function pruneEmails(token, payload) {
  return request('/v1/maintenance/prune-emails', {
    method: 'POST',
    token,
    body: payload,
  })
}

export function getTelegramSettings(token) {
  return request('/v1/system/telegram', { token })
}

export function updateTelegramSettings(token, payload) {
  return request('/v1/system/telegram', {
    method: 'PATCH',
    token,
    body: payload,
  })
}

export function registerTelegramCommands(token) {
  return request('/v1/system/telegram/commands/register', {
    method: 'POST',
    token,
  })
}
