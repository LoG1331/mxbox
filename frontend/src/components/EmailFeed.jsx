import { memo, useEffect, useState } from 'react'
import { MailOpen, Send, Trash2, UserRound, X } from 'lucide-react'
import { getEmailBodyText, getEmailPreview, getSenderLabel } from '../lib/email-feed.js'
import { cn, formatDateTime, truncate } from '../lib/format.js'
import { Badge, Button, Checkbox, CodeBlock, Panel } from './ui.jsx'

function buildEmailHtmlPreviewDoc(html) {
  const source = String(html || '').trim()
  if (!source) {
    return ''
  }

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <style>
      :root { color-scheme: light; }
      * { box-sizing: border-box; }
      body {
        margin: 0;
        padding: 20px;
        background: #fffdfa;
        color: #182526;
        font: 14px/1.6 Manrope, system-ui, sans-serif;
        overflow-wrap: anywhere;
      }
      img, video, iframe, table {
        max-width: 100%;
      }
      pre {
        white-space: pre-wrap;
        overflow-wrap: anywhere;
      }
    </style>
  </head>
  <body>${source}</body>
</html>`
}

export function EmailDetailModal({
  open,
  email,
  loadingDetail,
  includeRawMime,
  onToggleRawMime,
  deletingEmail,
  onDeleteEmail,
  onClose,
}) {
  const [previewMode, setPreviewMode] = useState(null)

  useEffect(() => {
    if (!open) {
      return undefined
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    window.addEventListener('keydown', handleKeyDown)

    return () => {
      document.body.style.overflow = previousOverflow
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [onClose, open])

  if (!open) {
    return null
  }

  const bodyText = getEmailBodyText(email)
  const hasHtmlPreview = Boolean(String(email?.html || '').trim())
  const htmlPreviewDoc = hasHtmlPreview ? buildEmailHtmlPreviewDoc(email.html) : ''
  const activePreviewMode = previewMode || (hasHtmlPreview ? 'html' : 'text')

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div
        className="panel panel-tone-sage flex max-h-[92vh] w-full max-w-4xl flex-col overflow-hidden rounded-t-2xl border border-white/10 !bg-[#1a1a1a]/95 shadow-2xl sm:rounded-2xl"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex flex-col gap-4 border-b border-white/5 px-4 py-4 sm:px-6">
          <h2 className="max-w-3xl text-lg font-bold tracking-tight text-white sm:text-xl">
            {truncate(email?.subject || '(No Subject)', 72)}
          </h2>

          <div className="flex items-center justify-between gap-3 sm:justify-end">
            <Checkbox
              label="Raw MIME"
              checked={includeRawMime}
              onChange={(event) => onToggleRawMime(event.target.checked)}
              className="min-w-0"
            />
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
              onClick={onClose}
              aria-label="Close email details"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        <div className="overflow-y-auto px-5 py-5 sm:px-6 sm:py-6">
          {email ? (
            <div className="space-y-4">
              <div className="grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-gray-400">From</p>
                  <p className="mt-2 break-words text-sm font-semibold text-white">{getSenderLabel(email)}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-gray-400">To</p>
                  <p className="mt-2 break-words text-sm font-semibold text-white">{email.to}</p>
                </div>
              </div>

              <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-gray-400">Received</p>
                  <p className="mt-2 text-sm font-semibold text-white">{formatDateTime(email.receivedAt)}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-gray-400">Domain</p>
                  <p className="mt-2 text-sm font-semibold text-white">{email.domain}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 p-4 sm:col-span-2 xl:col-span-1">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-gray-400">Message ID</p>
                  <p className="mt-2 break-all text-sm font-semibold text-white">{email.messageId || 'N/A'}</p>
                </div>
              </div>

              <div className="rounded-xl border border-white/10 bg-white/5 p-4 sm:p-5">
                <div className="flex flex-wrap items-center justify-end gap-3">
                  <div className="inline-flex rounded-full border border-white/10 bg-white/5 p-1">
                    <button
                      type="button"
                      onClick={() => setPreviewMode('html')}
                      disabled={!hasHtmlPreview}
                      className={cn(
                        'rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em] transition-colors',
                        activePreviewMode === 'html'
                          ? 'bg-[#38bdf8]/10 text-[#38bdf8]'
                          : 'text-gray-400 hover:text-white',
                        !hasHtmlPreview ? 'cursor-not-allowed opacity-40' : '',
                      )}
                    >
                      HTML
                    </button>
                    <button
                      type="button"
                      onClick={() => setPreviewMode('text')}
                      className={cn(
                        'rounded-full px-3 py-1.5 text-xs font-bold uppercase tracking-[0.14em] transition-colors',
                        activePreviewMode === 'text'
                          ? 'bg-[#38bdf8]/10 text-[#38bdf8]'
                          : 'text-gray-400 hover:text-white',
                      )}
                    >
                      Text
                    </button>
                  </div>
                </div>

                {activePreviewMode === 'html' && hasHtmlPreview ? (
                  <div className="mt-3 overflow-hidden rounded-xl border border-white/10 bg-white/5">
                    <iframe
                      title="Email HTML preview"
                      srcDoc={htmlPreviewDoc}
                      sandbox=""
                      referrerPolicy="no-referrer"
                      className="h-[26rem] w-full bg-transparent"
                    />
                  </div>
                ) : (
                  <p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-gray-300">
                    {bodyText || 'No text body'}
                  </p>
                )}
              </div>

              {email.rawMime ? (
                <div className="space-y-2">
                  <p className="text-xs font-bold uppercase tracking-[0.16em] text-gray-400">Raw MIME (base64)</p>
                  <CodeBlock value={email.rawMime} className="max-h-64" />
                </div>
              ) : null}

              <div className="flex flex-wrap gap-3">
                <Button variant="danger" icon={Trash2} loading={deletingEmail} onClick={onDeleteEmail}>
                  Delete
                </Button>
                {loadingDetail ? <Badge tone="warning">Reloading…</Badge> : null}
              </div>
            </div>
          ) : (
            <div className="rounded-xl border border-dashed border-white/10 bg-white/5 px-5 py-10 text-sm text-gray-400">
              Loading email…
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

export function EmailFeedList({
  title,
  description,
  total,
  emails,
  selectedEmailId,
  selectedEmailIds = [],
  selectable = false,
  loading,
  onOpenEmail,
  onToggleEmailSelection,
  onTogglePageSelection,
  emptyTitle,
  emptyDescription,
  action,
}) {
  const selectedCount = selectedEmailIds.length
  const allVisibleSelected = selectable && emails.length > 0 && emails.every((email) => selectedEmailIds.includes(email.id))

  return (
    <Panel
      title={title}
      description={description}
      tone="slate"
      className="flex h-full min-h-0 flex-col"
      action={action || (
        <div className="flex flex-wrap items-center gap-2">
          <Badge tone="accent">{total} mail</Badge>
          {loading ? <Badge tone="warning">Syncing…</Badge> : null}
        </div>
      )}
    >
      <div className="min-h-0 flex-1 overflow-y-auto">
      {emails.length ? (
        <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
          <div
            className={cn(
              'hidden items-center gap-4 border-b border-white/5 bg-white/[0.03] px-5 py-3 text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400 lg:grid',
              selectable
                ? 'lg:grid-cols-[52px_minmax(0,1.2fr)_minmax(220px,0.68fr)_180px]'
                : 'lg:grid-cols-[minmax(0,1.2fr)_minmax(220px,0.68fr)_180px]',
            )}
          >
            {selectable ? (
              <div className="flex items-center justify-center">
                <input
                  type="checkbox"
                  className="checkbox"
                  checked={allVisibleSelected}
                  onChange={(event) => onTogglePageSelection?.(event.target.checked)}
                  aria-label={allVisibleSelected ? 'Deselect all emails on this page' : 'Select all emails on this page'}
                />
              </div>
            ) : null}
            <p>Email</p>
            <p>From / To</p>
            <p className="text-right">Received</p>
          </div>

          <div className="grid gap-0">
            {emails.map((email) => {
              return (
                <EmailFeedRow
                  key={email.id}
                  email={email}
                  isActive={selectedEmailId === email.id}
                  isChecked={selectedEmailIds.includes(email.id)}
                  selectable={selectable}
                  onOpenEmail={onOpenEmail}
                  onToggleSelection={onToggleEmailSelection}
                />
              )
            })}
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-white/10 bg-white/5 px-6 py-12 text-center">
          <p className="text-xl font-bold text-white">{emptyTitle}</p>
          <p className="mt-3 text-sm leading-6 text-gray-400">{emptyDescription}</p>
          {selectable && selectedCount ? (
            <p className="mt-3 text-xs font-semibold uppercase tracking-[0.16em] text-gray-400">
              {selectedCount} selected will be cleared.
            </p>
          ) : null}
        </div>
      )}
      </div>
    </Panel>
  )
}

const EmailFeedRow = memo(function EmailFeedRow({
  email,
  isActive,
  isChecked,
  selectable,
  onOpenEmail,
  onToggleSelection,
}) {
  return (
    <div
      className={cn(
        'grid gap-3 border-b border-white/5 last:border-none',
        selectable ? 'grid-cols-[auto_minmax(0,1fr)]' : 'grid-cols-1',
        isActive
          ? 'bg-[#38bdf8]/10'
          : isChecked
            ? 'bg-[#38bdf8]/5'
            : 'bg-transparent',
      )}
    >
      {selectable ? (
        <div className="flex items-start justify-center px-3 pt-4 sm:px-4">
          <input
            type="checkbox"
            className="checkbox mt-1"
            checked={Boolean(isChecked)}
            onChange={(event) => onToggleSelection?.(email.id, event.target.checked)}
            aria-label={`Select email ${email.id}`}
          />
        </div>
      ) : null}

      <button
        type="button"
        onClick={() => onOpenEmail(email.id)}
        className={cn(
          'grid w-full gap-4 px-4 py-4 text-left transition-all duration-300 hover:bg-white/5 sm:px-5',
          selectable ? 'pl-0 sm:pl-0' : '',
          'lg:grid-cols-[minmax(0,1.2fr)_minmax(220px,0.68fr)_180px] lg:items-center',
        )}
      >
        <div className="min-w-0 space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <p className="font-semibold text-white">{truncate(email.subject || '(No Subject)', 96)}</p>
            {isChecked ? <Badge tone="success">Selected</Badge> : null}
            <Badge tone="neutral" className="lg:hidden">{email.domain}</Badge>
          </div>
          <p className="text-sm leading-6 text-gray-400">{getEmailPreview(email)}</p>
        </div>

        <div className="grid gap-2 text-sm text-white">
          <div className="flex items-center gap-2">
            <UserRound className="h-4 w-4 shrink-0 text-gray-400" />
            <p className="truncate font-medium">{getSenderLabel(email)}</p>
          </div>
          <div className="flex items-center gap-2">
            <Send className="h-4 w-4 shrink-0 text-gray-400" />
            <p className="truncate font-medium">{email.to}</p>
          </div>
        </div>

        <div className="flex flex-wrap items-center justify-between gap-2 text-sm text-gray-400 lg:justify-end">
          <Badge tone="neutral" className="hidden lg:inline-flex">{email.domain}</Badge>
          <div className="flex items-center gap-2">
            <MailOpen className="h-4 w-4 text-gray-400" />
            <p className="font-medium">{formatDateTime(email.receivedAt)}</p>
          </div>
        </div>
      </button>
    </div>
  )
})
