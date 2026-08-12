import { truncate } from './format.js'

export function getSenderLabel(email) {
  const name = String(email?.from?.name || '').trim()
  const address = String(email?.from?.address || email?.envelopeFrom || '').trim()

  if (name && address) {
    return `${name} <${address}>`
  }

  return name || address || 'Unknown sender'
}

export function getEmailBodyText(email) {
  return String(email?.text || '')
    .replace(/\s+/g, ' ')
    .trim()
}

/**
 * The list route only returns `preview` (first 400 chars) so the payload does
 * not grow with mail count; the detail route still returns full `text`, so
 * prefer it when available.
 */
export function getEmailPreview(email) {
  const source = String(email?.text || email?.preview || '')
    .replace(/\s+/g, ' ')
    .trim()

  if (source) {
    return truncate(source, 180)
  }

  const hasHtml = email?.hasHtml ?? Boolean(email?.html)
  return hasHtml ? 'This email contains HTML content.' : 'No text preview for this email.'
}
