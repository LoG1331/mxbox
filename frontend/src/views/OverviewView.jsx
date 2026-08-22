import { useEffect, useMemo, useRef, useState } from 'react'
import { Activity, Clock, Copy, Database, Eraser, Globe2, KeyRound, Loader2, Pencil, RefreshCcw, Send, Trash2 } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { changeMyPassword, clearEmails, getHealth, getMaintenanceStorage, pruneEmails, pruneRawMime, rotateMyApiKey, updateMe } from '../lib/api.js'
import { cn, formatApiError, formatBytes, formatDateTime, formatRelativeTime, getPermissionScopeLabel, normalizeOptional } from '../lib/format.js'
import { AutoRefreshButton, Badge, Button, Checkbox, CodeBlock, Field, Input, MetricCard, ModalShell, Panel } from '../components/ui.jsx'
import { useAutoRefresh } from '../hooks/useAutoRefresh.js'

const COMPACT_INPUT_CLASS = 'min-h-[44px] px-4 py-2.5 text-sm'
const STORAGE_WARNING_BYTES = 10 * 1024 * 1024 * 1024
const STORAGE_DANGER_BYTES = 20 * 1024 * 1024 * 1024

function buildDomainSummaries(accessibleDomains, permissions) {
  const domainMap = new Map()

  accessibleDomains.forEach((domain) => {
    domainMap.set(domain, {
      domain,
      permissions: [],
      activeCount: 0,
    })
  })

  permissions.forEach((permission) => {
    const domainKey = permission.domain
    if (!domainMap.has(domainKey)) {
      domainMap.set(domainKey, {
        domain: domainKey,
        permissions: [],
        activeCount: 0,
      })
    }

    const summary = domainMap.get(domainKey)
    summary.permissions.push(permission)

    if (permission.status === 'active') {
      summary.activeCount += 1
    }
  })

  return Array.from(domainMap.values()).sort((left, right) => left.domain.localeCompare(right.domain))
}

function createPruneEmailsForm() {
  return {
    olderThanDays: '30',
    domain: '',
    limit: '5000',
    dryRun: true,
  }
}

function getStorageSeverity(bytes) {
  const normalizedBytes = Number(bytes) || 0
  if (normalizedBytes >= STORAGE_DANGER_BYTES) {
    return 'danger'
  }

  if (normalizedBytes >= STORAGE_WARNING_BYTES) {
    return 'warning'
  }

  return 'success'
}

function getStorageSeverityLabel(bytes) {
  const severity = getStorageSeverity(bytes)
  if (severity === 'danger') {
    return 'Critical'
  }

  if (severity === 'warning') {
    return 'Warning'
  }

  return 'Healthy'
}

function getStorageCardClass(bytes) {
  const severity = getStorageSeverity(bytes)
  if (severity === 'danger') {
    return 'border-red-500/30 bg-red-500/10'
  }

  if (severity === 'warning') {
    return 'border-amber-500/30 bg-amber-500/10'
  }

  return 'border-white/10 bg-white/5'
}

function getStorageProgressBarClass(severity) {
  if (severity === 'danger') {
    return 'bg-gradient-to-r from-red-500/80 to-red-400'
  }

  if (severity === 'warning') {
    return 'bg-gradient-to-r from-amber-500/80 to-amber-400'
  }

  return 'bg-gradient-to-r from-[#38bdf8]/70 to-emerald-400/80'
}

function getStorageTextClass(severity) {
  if (severity === 'danger') {
    return 'text-red-400'
  }

  if (severity === 'warning') {
    return 'text-amber-400'
  }

  return 'text-emerald-400'
}

export default function OverviewView({
  token,
  account,
  accessibleDomains,
  sessionExpiresAt,
  onRefreshAccount,
  onRefreshSession,
}) {
  const [health, setHealth] = useState(null)
  const [storage, setStorage] = useState(null)
  const [loadingHealth, setLoadingHealth] = useState(false)
  const [loadingStorage, setLoadingStorage] = useState(false)
  const [editingField, setEditingField] = useState(null)
  const [inlineValue, setInlineValue] = useState('')
  const [savingInline, setSavingInline] = useState(false)
  const inlineCancelledRef = useRef(false)
  const inlineBusyRef = useRef(false)
  const [passwordForm, setPasswordForm] = useState({
    currentPassword: '',
    newPassword: '',
  })
  const [changingPassword, setChangingPassword] = useState(false)
  const [refreshingSession, setRefreshingSession] = useState(false)
  const [pruningRawMime, setPruningRawMime] = useState(false)
  const [pruningEmails, setPruningEmails] = useState(false)
  const [showPasswordForm, setShowPasswordForm] = useState(false)
  const [generatingApiKey, setGeneratingApiKey] = useState(false)
  const [apiKeyModalOpen, setApiKeyModalOpen] = useState(false)
  const [generatedApiKey, setGeneratedApiKey] = useState('')
  const [pruneEmailForm, setPruneEmailForm] = useState(createPruneEmailsForm)
  const [lastPruneResult, setLastPruneResult] = useState(null)
  const [clearEmailsModalOpen, setClearEmailsModalOpen] = useState(false)
  const [clearingEmails, setClearingEmails] = useState(false)

  const domainSummaries = useMemo(
    () => buildDomainSummaries(accessibleDomains, account.permissions),
    [accessibleDomains, account.permissions],
  )
  const activePermissionCount = domainSummaries.reduce((total, summary) => total + summary.activeCount, 0)
  const sqliteSeverity = getStorageSeverity(storage?.sqliteTotalBytes)
  const folderSeverity = getStorageSeverity(storage?.folderBytes)
  const highestStorageSeverity = sqliteSeverity === 'danger' || folderSeverity === 'danger'
    ? 'danger'
    : sqliteSeverity === 'warning' || folderSeverity === 'warning'
      ? 'warning'
      : 'success'

  const storagePeakBytes = Math.max(storage?.sqliteTotalBytes || 0, storage?.folderBytes || 0)
  const sqliteUsagePercent = storage?.sqliteTotalBytes
    ? Math.min(100, Math.round((storage.sqliteTotalBytes / STORAGE_DANGER_BYTES) * 100))
    : 0

  async function loadHealth({ showLoading = true, showError = true } = {}) {
    if (showLoading) {
      setLoadingHealth(true)
    }

    try {
      const response = await getHealth()
      setHealth(response)
      return response
    } catch (error) {
      if (showError) {
        toast.error(formatApiError(error))
      }
      return null
    } finally {
      setLoadingHealth(false)
    }
  }

  async function loadStorage({ showLoading = true, showError = true } = {}) {
    if (!account.isAdmin) {
      return null
    }

    if (showLoading) {
      setLoadingStorage(true)
    }

    try {
      const response = await getMaintenanceStorage(token)
      setStorage(response.storage || null)
      return response.storage || null
    } catch (error) {
      if (showError) {
        toast.error(formatApiError(error))
      }
      return null
    } finally {
      setLoadingStorage(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    async function bootstrapOverview() {
      setLoadingHealth(true)

      try {
        const response = await getHealth()
        if (!cancelled) {
          setHealth(response)
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(formatApiError(error))
        }
      } finally {
        if (!cancelled) {
          setLoadingHealth(false)
        }
      }

      if (!account.isAdmin) {
        return
      }

      setLoadingStorage(true)

      try {
        const response = await getMaintenanceStorage(token)
        if (!cancelled) {
          setStorage(response.storage || null)
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(formatApiError(error))
        }
      } finally {
        if (!cancelled) {
          setLoadingStorage(false)
        }
      }
    }

    void bootstrapOverview()

    return () => {
      cancelled = true
    }
  }, [account.isAdmin, token])

  const refreshNow = useAutoRefresh(async () => {
    await loadHealth({
      showLoading: false,
      showError: false,
    })
    await loadStorage({
      showLoading: false,
      showError: false,
    })
  }, 10000)

  function startInlineEdit(field, initialValue) {
    inlineCancelledRef.current = false
    setInlineValue(initialValue)
    setEditingField(field)
  }

  function cancelInlineEdit() {
    inlineCancelledRef.current = true
    setEditingField(null)
  }

  async function commitInlineEdit() {
    if (!editingField || inlineCancelledRef.current) {
      inlineCancelledRef.current = false
      return
    }

    if (inlineBusyRef.current) {
      return
    }

    const field = editingField
    const currentValue = field === 'displayName' ? account.displayName || '' : account.telegramId || ''
    if (inlineValue.trim() === currentValue.trim()) {
      setEditingField(null)
      return
    }

    setSavingInline(true)
    inlineBusyRef.current = true

    try {
      await updateMe(token, {
        displayName: field === 'displayName' ? inlineValue : account.displayName || '',
        telegramId: field === 'telegramId' ? normalizeOptional(inlineValue) : normalizeOptional(account.telegramId || ''),
      })
      await onRefreshAccount()
      toast.success('Profile updated')
      setEditingField(null)
    } catch (error) {
      toast.error(formatApiError(error))
      setEditingField(null)
    } finally {
      inlineBusyRef.current = false
      setSavingInline(false)
    }
  }

  function handleInlineKeyDown(event) {
    if (event.key === 'Enter') {
      event.preventDefault()
      void commitInlineEdit()
    } else if (event.key === 'Escape') {
      event.preventDefault()
      cancelInlineEdit()
    }
  }

  async function handlePasswordSubmit(event) {
    event.preventDefault()
    setChangingPassword(true)

    try {
      await changeMyPassword(token, passwordForm)
      setPasswordForm({
        currentPassword: '',
        newPassword: '',
      })
      toast.success('Password changed')
      setShowPasswordForm(false)
    } catch (error) {
      toast.error(formatApiError(error))
    } finally {
      setChangingPassword(false)
    }
  }

  async function handleSessionRefresh() {
    setRefreshingSession(true)

    try {
      await onRefreshSession()
      toast.success('Session extended')
    } catch (error) {
      toast.error(formatApiError(error))
    } finally {
      setRefreshingSession(false)
    }
  }

  async function handlePrune() {
    setPruningRawMime(true)

    try {
      const result = await pruneRawMime(token)
      await loadStorage({
        showLoading: false,
        showError: false,
      })
      toast.success(result.skipped ? 'Raw MIME prune skipped per cycle' : `Pruned ${result.updated} raw MIME records`)
    } catch (error) {
      toast.error(formatApiError(error))
    } finally {
      setPruningRawMime(false)
    }
  }

  async function handlePruneEmails(event) {
    event.preventDefault()
    setPruningEmails(true)

    try {
      const parsedOlderThanDays = Number.parseInt(pruneEmailForm.olderThanDays, 10)
      const payload = {
        olderThanDays: Number.isInteger(parsedOlderThanDays) && parsedOlderThanDays >= 1 ? parsedOlderThanDays : 30,
        dryRun: pruneEmailForm.dryRun,
        limit: Number.parseInt(pruneEmailForm.limit, 10) || 5000,
      }

      const normalizedDomain = normalizeOptional(pruneEmailForm.domain)
      if (normalizedDomain) {
        payload.domain = normalizedDomain
      }

      const result = await pruneEmails(token, payload)
      setLastPruneResult(result)

      if (result.dryRun) {
        toast.success(`Preview: ${result.selected}/${result.matched} emails prunable`)
      } else {
        await loadStorage({
          showLoading: false,
          showError: false,
        })
        toast.success(`Deleted ${result.deleted} old emails`)
      }
    } catch (error) {
      toast.error(formatApiError(error))
    } finally {
      setPruningEmails(false)
    }
  }

  async function handleClearEmails() {
    setClearingEmails(true)

    try {
      const result = await clearEmails(token)
      await loadStorage({
        showLoading: false,
        showError: false,
      })
      setClearEmailsModalOpen(false)
      setLastPruneResult(null)
      toast.success(`Deleted ${result.deletedEmails} emails`)
    } catch (error) {
      toast.error(formatApiError(error))
    } finally {
      setClearingEmails(false)
    }
  }

  async function handleCreateApiKey() {
    setGeneratingApiKey(true)

    try {
      const response = await rotateMyApiKey(token)
      setGeneratedApiKey(response.apiKey)
      setApiKeyModalOpen(true)
      await onRefreshAccount()
      toast.success('New API key created')
    } catch (error) {
      toast.error(formatApiError(error))
    } finally {
      setGeneratingApiKey(false)
    }
  }

  async function handleCopyApiKey() {
    try {
      await navigator.clipboard.writeText(generatedApiKey)
      toast.success('API key copied')
    } catch {
      toast.error('Failed to copy API key')
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="min-h-0 flex-1 space-y-5 overflow-y-auto">
      <Panel tone="sage">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex min-w-0 items-center gap-4">
            <div className="flex h-14 w-14 shrink-0 items-center justify-center rounded-2xl border border-[#38bdf8]/20 bg-[#38bdf8]/10 text-xl font-bold uppercase text-[#38bdf8]">
              {(account.displayName || account.username || '?').charAt(0)}
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                {editingField === 'displayName' ? (
                  <span className="relative inline-flex items-center">
                    <input
                      autoFocus
                      className="w-56 max-w-full rounded-none border-0 border-b-2 border-[#38bdf8] bg-transparent p-0 pr-6 text-xl font-bold leading-7 tracking-tight text-white outline-none transition-none focus:ring-0 disabled:opacity-60 sm:text-2xl sm:leading-8"
                      value={inlineValue}
                      disabled={savingInline}
                      placeholder="Display name"
                      onChange={(event) => setInlineValue(event.target.value)}
                      onBlur={() => void commitInlineEdit()}
                      onKeyDown={handleInlineKeyDown}
                    />
                    {savingInline ? (
                      <Loader2 className="absolute right-3 h-4 w-4 animate-spin text-[#38bdf8]" />
                    ) : null}
                  </span>
                ) : (
                  <h2
                    className="group inline-flex cursor-text items-center gap-2 truncate text-xl font-bold tracking-tight text-white sm:text-2xl"
                    title="Double-click to edit"
                    onDoubleClick={() => startInlineEdit('displayName', account.displayName || '')}
                  >
                    <span className="truncate">{account.displayName || 'Not set'}</span>
                    <Pencil className="h-4 w-4 shrink-0 text-gray-500 opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
                  </h2>
                )}
                <Badge tone={account.status === 'active' ? 'success' : 'warning'}>{account.status}</Badge>
                {account.isAdmin ? <Badge tone="accent">Global Admin</Badge> : null}
              </div>
              <p className="mt-1 truncate text-sm text-gray-400">{`@${account.username}`}</p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <Button size="sm" variant="secondary" onClick={() => setShowPasswordForm(true)}>
              Change Password
            </Button>
            <Button
              size="sm"
              variant="secondary"
              icon={KeyRound}
              loading={generatingApiKey}
              onClick={handleCreateApiKey}
            >
              New API Key
            </Button>
            <Button size="sm" variant="secondary" icon={RefreshCcw} loading={refreshingSession} onClick={handleSessionRefresh}>
              Extend Session
            </Button>
          </div>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/5 pt-4">
          <AutoRefreshButton onClick={refreshNow} />
          {loadingHealth ? <Badge tone="warning">Syncing…</Badge> : null}
          <Badge tone={health?.ok ? 'success' : 'warning'}>{health?.ok ? 'System healthy' : 'Status unknown'}</Badge>
          {health?.storage?.engine ? <Badge tone="neutral">{health.storage.engine}</Badge> : null}
        </div>
      </Panel>

      <div className="grid grid-cols-2 gap-3 sm:gap-4 xl:grid-cols-4">
        <MetricCard
          label="Granted Domains"
          value={domainSummaries.length}
          helper={`${activePermissionCount} active permissions`}
          icon={Globe2}
          tone="accent"
        />
        <MetricCard
          label="Session Expires"
          value={sessionExpiresAt ? formatDateTime(sessionExpiresAt) : 'Unknown'}
          icon={Clock}
          tone="neutral"
        />
        <MetricCard
          label="Last Seen"
          value={formatRelativeTime(account.lastSeenAt)}
          icon={Activity}
          tone="neutral"
        />
        <div
          className={cn(
            'muted-card rounded-2xl p-3.5 sm:p-4',
            editingField === 'telegramId' ? '' : 'cursor-text',
          )}
          title={editingField === 'telegramId' ? undefined : 'Double-click to edit'}
          onDoubleClick={() => {
            if (editingField !== 'telegramId') {
              startInlineEdit('telegramId', account.telegramId || '')
            }
          }}
        >
          <div className="mb-3 flex items-start justify-between gap-3">
            <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">Telegram</p>
            <span className="inline-flex h-8 w-8 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-gray-300">
              <Send className="h-4 w-4" />
            </span>
          </div>
          <div className="space-y-1">
            {editingField === 'telegramId' ? (
              <span className="relative inline-flex w-full items-center">
                <input
                  autoFocus
                  className="w-full rounded-none border-0 border-b-2 border-[#38bdf8] bg-transparent p-0 pr-6 text-2xl font-bold leading-8 tracking-tight text-white outline-none transition-none focus:ring-0 disabled:opacity-60"
                  value={inlineValue}
                  disabled={savingInline}
                  placeholder="123456789"
                  inputMode="numeric"
                  onChange={(event) => setInlineValue(event.target.value)}
                  onBlur={() => void commitInlineEdit()}
                  onKeyDown={handleInlineKeyDown}
                />
                {savingInline ? (
                  <Loader2 className="absolute right-3 h-4 w-4 animate-spin text-[#38bdf8]" />
                ) : null}
              </span>
            ) : (
              <p className="group inline-flex items-center gap-2 text-2xl font-bold tracking-tight text-white">
                <span className="truncate">{account.telegramId || 'Not set'}</span>
                <Pencil className="h-3.5 w-3.5 shrink-0 text-gray-500 opacity-0 transition-opacity duration-200 group-hover:opacity-100" />
              </p>
            )}
            <p className="text-[11px] leading-4 text-gray-400">Double-click to edit</p>
          </div>
        </div>
      </div>

      <Panel
        title="Domains"
        tone="slate"
        action={<Badge tone="accent">{domainSummaries.length} domain</Badge>}
      >
        {domainSummaries.length ? (
          <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
            {domainSummaries.map((summary) => (
              <div key={summary.domain} className="flex h-full flex-col rounded-xl border border-white/10 bg-white/5 px-4 py-3 transition-all duration-300 hover:bg-white/10">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <Globe2 className="h-4 w-4 text-[#38bdf8]" />
                      <p className="truncate text-sm font-semibold text-white">{summary.domain}</p>
                    </div>
                    <p className="mt-1 text-xs text-gray-400">
                      {summary.permissions.length
                        ? `${summary.activeCount} active permissions`
                        : 'Via current session'}
                    </p>
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    {summary.permissions.length ? <Badge tone="success">Active</Badge> : null}
                    <Badge tone="neutral">{summary.permissions.length}</Badge>
                  </div>
                </div>

                {summary.permissions.length ? (
                  <div className="mt-2.5 flex flex-wrap gap-2">
                    {summary.permissions.slice(0, 4).map((permission) => (
                      <Badge key={permission.id} tone="success">
                        {getPermissionScopeLabel(permission)}
                      </Badge>
                    ))}
                    {summary.permissions.length > 4 ? <Badge tone="neutral">+{summary.permissions.length - 4}</Badge> : null}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        ) : (
          <div className="rounded-xl border border-dashed border-white/10 bg-white/5 px-5 py-6 text-sm text-gray-400">
            No domains available for this account.
          </div>
        )}
      </Panel>

      <Panel
        title="System"
        tone="sand"
        action={account.isAdmin ? <Badge tone="accent">Admin Tools</Badge> : <Badge tone="neutral">View Only</Badge>}
      >
        <div className="grid gap-3 sm:grid-cols-3">
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 transition-all duration-300 hover:bg-white/10">
            <span className={cn(
              'inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border',
              health?.ok
                ? 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400'
                : 'border-white/10 bg-white/5 text-gray-300',
            )}
            >
              <Activity className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">Service</p>
              <p className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-white">
                {health?.ok ? <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-400" /> : null}
                <span className="truncate">{health?.service || 'Unknown'}</span>
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 transition-all duration-300 hover:bg-white/10">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#38bdf8]/20 bg-[#38bdf8]/10 text-[#38bdf8]">
              <Globe2 className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">Environment</p>
              <p className="mt-0.5 truncate text-sm font-semibold text-white">{health?.nodeEnv || 'Unknown'}</p>
            </div>
          </div>
          <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 transition-all duration-300 hover:bg-white/10">
            <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-white/10 bg-white/5 text-gray-300">
              <Clock className="h-4 w-4" />
            </span>
            <div className="min-w-0">
              <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">System Time</p>
              <p className="mt-0.5 truncate text-sm font-semibold text-white">{health?.systemTime ? formatDateTime(health.systemTime) : 'Unknown'}</p>
            </div>
          </div>
        </div>

        {account.isAdmin ? (
          <>
            <div className="mt-5 border-t border-white/5 pt-5">
              <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">Storage</p>
                  {loadingStorage
                    ? <Badge tone="warning">Syncing…</Badge>
                    : <Badge tone={highestStorageSeverity}>{getStorageSeverityLabel(storagePeakBytes)}</Badge>}
                </div>
                <div className="flex flex-wrap items-center gap-2">
                  <Button size="sm" variant="secondary" icon={RefreshCcw} onClick={() => loadStorage()} loading={loadingStorage}>
                    Refresh
                  </Button>
                  <Button size="sm" variant="secondary" icon={Eraser} loading={pruningRawMime} onClick={handlePrune}>
                    Prune MIME
                  </Button>
                </div>
              </div>

              {highestStorageSeverity !== 'success' ? (
                <div className={cn(
                  'mb-4 flex items-center gap-2.5 rounded-xl border px-4 py-3 text-sm font-semibold',
                  highestStorageSeverity === 'danger'
                    ? 'border-red-500/30 bg-red-500/10 text-red-400'
                    : 'border-amber-500/30 bg-amber-500/10 text-amber-400',
                )}
                >
                  <span className={cn(
                    'h-2 w-2 shrink-0 animate-pulse rounded-full',
                    highestStorageSeverity === 'danger' ? 'bg-red-400' : 'bg-amber-400',
                  )}
                  />
                  <p>
                    {highestStorageSeverity === 'danger'
                      ? 'Storage exceeded 20 GB. Prune old emails now and check retention/raw MIME.'
                      : 'Storage exceeded 10 GB. Schedule pruning soon to avoid DB growth.'}
                  </p>
                </div>
              ) : null}

              <div className={cn('rounded-xl border px-4 py-4 transition-all duration-300 sm:px-5', getStorageCardClass(storage?.sqliteTotalBytes))}>
                <div className="flex flex-wrap items-end justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">
                      <Database className="h-3.5 w-3.5 text-[#38bdf8]" />
                      SQLite Total
                    </p>
                    <p className="mt-1.5 text-3xl font-bold tracking-tight text-white">{formatBytes(storage?.sqliteTotalBytes)}</p>
                    <p className="mt-1 text-xs text-gray-400">{storage ? `${storage.sqliteTotalBytes.toLocaleString('en-US')} bytes` : 'No data'}</p>
                  </div>
                  {storage ? <Badge tone={sqliteSeverity}>{getStorageSeverityLabel(storage.sqliteTotalBytes)}</Badge> : null}
                </div>

                <div className="mt-4">
                  <div className="flex items-center justify-between gap-3 text-[11px] text-gray-400">
                    <span className="font-bold uppercase tracking-[0.16em]">Usage</span>
                    <span>
                      <span className={cn('font-semibold', getStorageTextClass(sqliteSeverity))}>{sqliteUsagePercent}%</span>
                      {' · warning at 10 / 20 GB'}
                    </span>
                  </div>
                  <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-white/10">
                    <div
                      className={cn('h-full rounded-full transition-all duration-300', getStorageProgressBarClass(sqliteSeverity))}
                      style={{ width: `${sqliteUsagePercent}%` }}
                    />
                  </div>
                </div>
              </div>

              <div className="mt-3 grid gap-3 sm:grid-cols-3">
                <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 transition-all duration-300 hover:bg-white/10">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">SQLite main</p>
                  <p className="mt-1.5 text-sm font-semibold text-white">{formatBytes(storage?.sqliteBytes)}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 transition-all duration-300 hover:bg-white/10">
                  <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">WAL / SHM</p>
                  <p className="mt-1.5 text-sm font-semibold text-white">{`${formatBytes(storage?.walBytes)} / ${formatBytes(storage?.shmBytes)}`}</p>
                </div>
                <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3 transition-all duration-300 hover:bg-white/10">
                  <div className="flex items-center justify-between gap-2">
                    <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">DB Folder</p>
                    {storage ? <Badge tone={folderSeverity}>{getStorageSeverityLabel(storage.folderBytes)}</Badge> : null}
                  </div>
                  <p className="mt-1.5 text-sm font-semibold text-white">{formatBytes(storage?.folderBytes)}</p>
                  <p className="mt-1 truncate text-xs text-gray-400">{storage?.storageDir || 'No data'}</p>
                </div>
              </div>

              <form className="mt-5 grid gap-3 border-t border-white/5 pt-5" onSubmit={handlePruneEmails}>
                <div className="grid gap-3 sm:grid-cols-3">
                  <Field label="Older than (days)">
                    <Input
                      className={COMPACT_INPUT_CLASS}
                      inputMode="numeric"
                      min="1"
                      value={pruneEmailForm.olderThanDays}
                      onChange={(event) => setPruneEmailForm((current) => ({ ...current, olderThanDays: event.target.value }))}
                      placeholder="30"
                    />
                  </Field>
                  <Field label="Limit per run">
                    <Input
                      className={COMPACT_INPUT_CLASS}
                      inputMode="numeric"
                      value={pruneEmailForm.limit}
                      onChange={(event) => setPruneEmailForm((current) => ({ ...current, limit: event.target.value }))}
                      placeholder="5000"
                    />
                  </Field>
                  <Field label="Domain">
                    <Input
                      className={COMPACT_INPUT_CLASS}
                      value={pruneEmailForm.domain}
                      onChange={(event) => setPruneEmailForm((current) => ({ ...current, domain: event.target.value }))}
                      placeholder="example.com"
                    />
                  </Field>
                </div>

                <Checkbox
                  label="Dry run (no deletion)"
                  checked={pruneEmailForm.dryRun}
                  onChange={(event) => setPruneEmailForm((current) => ({ ...current, dryRun: event.target.checked }))}
                />

                <div className="flex flex-wrap gap-2">
                  <Button type="submit" size="sm" variant={pruneEmailForm.dryRun ? 'primary' : 'danger'} icon={Trash2} loading={pruningEmails}>
                    {pruneEmailForm.dryRun ? 'Preview' : 'Prune Emails'}
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="ghost"
                    onClick={() => {
                      setPruneEmailForm(createPruneEmailsForm())
                      setLastPruneResult(null)
                    }}
                  >
                    Reset
                  </Button>
                  <Button
                    type="button"
                    size="sm"
                    variant="danger"
                    icon={Trash2}
                    onClick={() => setClearEmailsModalOpen(true)}
                  >
                    Clear All Emails
                  </Button>
                </div>

                {lastPruneResult ? (
                  <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-4 text-sm">
                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone={lastPruneResult.dryRun ? 'warning' : 'success'}>
                        {lastPruneResult.dryRun ? 'Preview Result' : 'Pruned'}
                      </Badge>
                      <Badge tone="neutral">{`${lastPruneResult.selected}/${lastPruneResult.matched}`}</Badge>
                      {lastPruneResult.hasMore ? <Badge tone="warning">More data remains</Badge> : null}
                    </div>

                    <div className="mt-3 grid gap-3 sm:grid-cols-4">
                      <div className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5">
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">Deleted</p>
                        <p className="mt-1 font-semibold text-white">{lastPruneResult.deleted}</p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5">
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">Remaining</p>
                        <p className="mt-1 font-semibold text-white">
                          {lastPruneResult.dryRun
                            ? lastPruneResult.matched - lastPruneResult.selected
                            : lastPruneResult.remaining ?? 0}
                        </p>
                      </div>
                      <div className="rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 sm:col-span-2">
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">Mail Range</p>
                        <p className="mt-1 font-semibold text-white">
                          {lastPruneResult.oldestReceivedAt ? formatDateTime(lastPruneResult.oldestReceivedAt) : 'N/A'}
                          {' → '}
                          {lastPruneResult.newestReceivedAt ? formatDateTime(lastPruneResult.newestReceivedAt) : 'N/A'}
                        </p>
                      </div>
                    </div>

                    {lastPruneResult.vacuum ? (
                      <div className="mt-3 rounded-xl border border-[#38bdf8]/20 bg-[#38bdf8]/5 px-3.5 py-3">
                        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-[#38bdf8]">Vacuum</p>
                        <p className="mt-1 text-sm font-semibold text-white">
                          {`${formatBytes(lastPruneResult.vacuum.before?.totalBytes)} → ${formatBytes(lastPruneResult.vacuum.after?.totalBytes)}`}
                        </p>
                        <p className="mt-1 text-xs text-gray-400">
                          {`main ${formatBytes(lastPruneResult.vacuum.before?.sqliteBytes)} → ${formatBytes(lastPruneResult.vacuum.after?.sqliteBytes)}, wal ${formatBytes(lastPruneResult.vacuum.before?.walBytes)} → ${formatBytes(lastPruneResult.vacuum.after?.walBytes)}`}
                        </p>
                      </div>
                    ) : null}
                  </div>
                ) : null}
              </form>
            </div>
          </>
        ) : (
          <p className="mt-3 text-sm text-gray-400">
            Only global admins can run maintenance.
          </p>
        )}
      </Panel>
      </div>

      <ModalShell
        open={showPasswordForm}
        onClose={() => setShowPasswordForm(false)}
        title="Change Password"
        tone="sage"
        size="md"
      >
        <form className="grid gap-3" onSubmit={handlePasswordSubmit}>
          <input className="sr-only" readOnly tabIndex={-1} autoComplete="username" value={account.username} />
          <Field label="Current Password">
            <Input
              className={COMPACT_INPUT_CLASS}
              type="password"
              autoComplete="current-password"
              value={passwordForm.currentPassword}
              onChange={(event) => setPasswordForm((current) => ({ ...current, currentPassword: event.target.value }))}
            />
          </Field>

          <Field label="New Password" hint="Min 8 characters">
            <Input
              className={COMPACT_INPUT_CLASS}
              type="password"
              autoComplete="new-password"
              value={passwordForm.newPassword}
              onChange={(event) => setPasswordForm((current) => ({ ...current, newPassword: event.target.value }))}
            />
          </Field>

          <div className="flex flex-wrap gap-2">
            <Button type="submit" size="sm" loading={changingPassword}>
              Update Password
            </Button>
          </div>
        </form>
      </ModalShell>

      <ModalShell
        open={clearEmailsModalOpen}
        onClose={() => setClearEmailsModalOpen(false)}
        title="Clear All Emails"
        tone="ember"
        size="md"
      >
        <div className="space-y-4">
          <p className="text-sm text-gray-300">
            This permanently deletes <span className="font-bold text-white">every stored email</span>, including
            group links and pending Telegram notifications. Registered mailboxes and domains are kept.
          </p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="danger" icon={Trash2} loading={clearingEmails} onClick={() => void handleClearEmails()}>
              Delete Everything
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setClearEmailsModalOpen(false)} disabled={clearingEmails}>
              Cancel
            </Button>
          </div>
        </div>
      </ModalShell>

      <ModalShell
        open={apiKeyModalOpen}
        onClose={() => setApiKeyModalOpen(false)}
        title="New API Key"
        tone="ember"
        size="md"
      >
        <div className="space-y-4">
          <CodeBlock value={generatedApiKey || 'N/A'} />
          <div className="flex flex-wrap gap-2">
            <Button size="sm" icon={Copy} onClick={handleCopyApiKey} disabled={!generatedApiKey}>
              Copy
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setApiKeyModalOpen(false)}>
              Close
            </Button>
          </div>
        </div>
      </ModalShell>
    </div>
  )
}
