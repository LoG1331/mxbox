import { useEffect, useState } from 'react'
import { Ban, ShieldOff, Trash2 } from 'lucide-react'
import { toast } from 'react-hot-toast'
import {
  createBlockedSender,
  deleteBlockedSender,
  getBlockedSender,
  listBlockedSenders,
  listDomains,
  updateBlockedSender,
} from '../lib/api.js'
import { cn, findIssueMessage, formatApiError, formatDateTime, normalizeOptional, truncate } from '../lib/format.js'
import { clampOffset } from '../lib/pagination.js'
import { AutoRefreshButton, Badge, Button, CompactPagination, EmptyState, Field, FormError, Input, ModalShell, Panel, Select, TextArea } from '../components/ui.jsx'
import { useAutoRefresh } from '../hooks/useAutoRefresh.js'

const STATUS_OPTIONS = ['active', 'disabled']
const PATTERN_TYPE_OPTIONS = [
  { value: '', label: 'Auto-detect' },
  { value: 'email', label: 'Specific email' },
  { value: 'domain', label: 'Entire domain' },
]
const COMPACT_INPUT_CLASS = 'min-h-[44px] rounded-xl px-4 py-2.5 text-sm'
const HEADER_INPUT_CLASS = 'rounded-xl px-4 py-2.5 text-sm'
const HEADER_SELECT_CLASS = 'min-w-[160px] rounded-xl px-4 py-2.5 text-sm'
const CREATE_HANDLED_FIELDS = ['pattern', 'patternType', 'domain', 'status', 'reason']

function emptyBlockForm() {
  return {
    pattern: '',
    patternType: '',
    domain: '',
    reason: '',
    status: 'active',
  }
}

function patternTypeLabel(patternType) {
  return patternType === 'domain' ? 'Sender Domain' : 'Sender Email'
}

function BlockCreateModal({ open, form, domains, saving, error, onChange, onSubmit, onClose }) {
  const patternError = findIssueMessage(error, 'pattern')

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Block New Sender"
      tone="ember"
      size="lg"
    >
      <form className="grid gap-4 md:grid-cols-2" onSubmit={onSubmit}>
        <FormError error={error} handledFields={CREATE_HANDLED_FIELDS} className="md:col-span-2" />
        <Field label="Sender" error={patternError}>
          <Input
            className={COMPACT_INPUT_CLASS}
            value={form.pattern}
            invalid={Boolean(patternError)}
            onChange={(event) => onChange((current) => ({ ...current, pattern: event.target.value }))}
            placeholder="spam@example.com"
          />
        </Field>
        <Field
          label="Block Type"
          hint="Includes subdomains"
          error={findIssueMessage(error, 'patternType')}
        >
          <Select
            className={COMPACT_INPUT_CLASS}
            value={form.patternType}
            onChange={(event) => onChange((current) => ({ ...current, patternType: event.target.value }))}
          >
            {PATTERN_TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </Select>
        </Field>
        <Field
          label="Scope"
          error={findIssueMessage(error, 'domain')}
        >
          <Select
            className={COMPACT_INPUT_CLASS}
            value={form.domain}
            invalid={Boolean(findIssueMessage(error, 'domain'))}
            onChange={(event) => onChange((current) => ({ ...current, domain: event.target.value }))}
          >
            <option value="">System-wide</option>
            {domains.map((domain) => (
              <option key={domain.domain} value={domain.domain}>Only {domain.domain}</option>
            ))}
          </Select>
        </Field>
        <Field label="Status" error={findIssueMessage(error, 'status')}>
          <Select
            className={COMPACT_INPUT_CLASS}
            value={form.status}
            onChange={(event) => onChange((current) => ({ ...current, status: event.target.value }))}
          >
            {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
          </Select>
        </Field>
        <Field label="Reason" className="md:col-span-2" error={findIssueMessage(error, 'reason')}>
          <TextArea
            rows={3}
            value={form.reason}
            onChange={(event) => onChange((current) => ({ ...current, reason: event.target.value }))}
            placeholder="Promotional spam"
          />
        </Field>
        <div className="md:col-span-2 flex flex-wrap gap-3">
          <Button type="submit" icon={Ban} loading={saving}>Block Sender</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
        </div>
      </form>
    </ModalShell>
  )
}

function BlockDetailModal({
  open,
  blockedSender,
  loading,
  saving,
  deleting,
  error,
  onToggleStatus,
  onDelete,
  onClose,
}) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={blockedSender ? blockedSender.pattern : 'Block Details'}
      tone="slate"
      size="lg"
      action={blockedSender ? (
        <div className="flex flex-wrap items-center gap-2">
          {loading ? <Badge tone="warning">Syncing…</Badge> : null}
          <Badge tone={blockedSender.status === 'active' ? 'danger' : 'neutral'}>{blockedSender.status}</Badge>
          <Badge tone="accent">{patternTypeLabel(blockedSender.patternType)}</Badge>
        </div>
      ) : loading ? <Badge tone="warning">Syncing…</Badge> : null}
    >
      {blockedSender ? (
        <div className="space-y-5">
          <FormError error={error} />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-gray-400">Scope</p>
              <p className="mt-2 text-sm font-semibold text-white">{blockedSender.domain || 'System-wide'}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-gray-400">Blocked</p>
              <p className="mt-2 text-sm font-semibold text-white">{blockedSender.matchCount}</p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-gray-400">Last Blocked</p>
              <p className="mt-2 text-sm font-semibold text-white">
                {blockedSender.lastMatchedAt ? formatDateTime(blockedSender.lastMatchedAt) : 'None'}
              </p>
            </div>
            <div className="rounded-xl border border-white/10 bg-white/5 p-4">
              <p className="text-xs font-bold uppercase tracking-[0.16em] text-gray-400">Created By</p>
              <p className="mt-2 text-sm font-semibold text-white">
                {blockedSender.createdBy?.username ? `@${blockedSender.createdBy.username}` : blockedSender.createdBy?.label || 'Unknown'}
              </p>
            </div>
          </div>

          <section className="rounded-xl border border-white/10 bg-white/5 p-4">
            <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400">Reason</p>
            <p className="mt-2 text-sm leading-6 text-gray-300">{blockedSender.reason || 'No reason given'}</p>

            <div className="mt-4 flex flex-wrap items-center gap-2 border-t border-white/5 pt-4">
              <Badge tone="neutral">Created {formatDateTime(blockedSender.createdAt)}</Badge>
              <Badge tone="neutral">Updated {formatDateTime(blockedSender.updatedAt)}</Badge>
            </div>

            <div className="mt-4 flex flex-wrap gap-3">
              <Button type="button" icon={ShieldOff} loading={saving} onClick={onToggleStatus}>
                {blockedSender.status === 'active' ? 'Disable' : 'Enable'}
              </Button>
              <Button type="button" variant="danger" icon={Trash2} loading={deleting} onClick={onDelete}>Delete</Button>
              <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
            </div>
          </section>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-white/10 bg-white/5 px-5 py-10 text-sm text-gray-400">
          Loading rule details...        </div>
      )}
    </ModalShell>
  )
}

export default function BlockedSendersView({ token }) {
  const [filters, setFilters] = useState({
    q: '',
    patternType: '',
    status: '',
    scope: '',
    limit: 50,
    offset: 0,
  })
  const [searchDraft, setSearchDraft] = useState('')
  const [blockedSenders, setBlockedSenders] = useState([])
  const [totalBlockedSenders, setTotalBlockedSenders] = useState(0)
  const [domainOptions, setDomainOptions] = useState([])
  const [loadingList, setLoadingList] = useState(false)
  const [selectedId, setSelectedId] = useState(null)
  const [selectedBlockedSender, setSelectedBlockedSender] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [creating, setCreating] = useState(false)
  const [savingDetail, setSavingDetail] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [createForm, setCreateForm] = useState(emptyBlockForm())
  const [createError, setCreateError] = useState(null)
  const [detailError, setDetailError] = useState(null)

  async function loadDomainOptions({ showError = true } = {}) {
    try {
      const response = await listDomains(token, { limit: 200, offset: 0 })
      setDomainOptions(response.domains)
    } catch (error) {
      if (showError) {
        toast.error(formatApiError(error))
      }
    }
  }

  async function loadBlockedSenders(
    preferredId = selectedId,
    activeFilters = filters,
    { showLoading = true, showError = true } = {},
  ) {
    if (showLoading) {
      setLoadingList(true)
    }

    try {
      const response = await listBlockedSenders(token, activeFilters)
      if (!response.blockedSenders.length && activeFilters.offset > 0 && response.total <= activeFilters.offset) {
        setFilters((current) => ({
          ...current,
          offset: clampOffset(current.offset, response.total, current.limit),
        }))
      }

      setBlockedSenders(response.blockedSenders)
      setTotalBlockedSenders(response.total)

      if (preferredId && !response.blockedSenders.some((item) => item.id === preferredId)) {
        setSelectedId(null)
        setSelectedBlockedSender(null)
      }

      return response
    } catch (error) {
      if (showError) {
        toast.error(formatApiError(error))
      }
      return null
    } finally {
      setLoadingList(false)
    }
  }

  async function loadDetail(blockedSenderId = selectedId, { showLoading = true, showError = true } = {}) {
    if (!blockedSenderId) {
      return null
    }

    if (showLoading) {
      setLoadingDetail(true)
    }

    try {
      const response = await getBlockedSender(token, blockedSenderId)
      setSelectedBlockedSender(response.blockedSender)
      return response
    } catch (error) {
      if (showError) {
        toast.error(formatApiError(error))
      }
      return null
    } finally {
      setLoadingDetail(false)
    }
  }

  useEffect(() => {
    void loadDomainOptions({ showError: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => {
    void loadBlockedSenders(null, filters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, filters.q, filters.patternType, filters.status, filters.scope, filters.limit, filters.offset])

  useEffect(() => {
    if (!selectedId) {
      setSelectedBlockedSender(null)
      return
    }

    void loadDetail(selectedId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, token])

  const refreshNow = useAutoRefresh(async () => {
    await loadBlockedSenders(selectedId, filters, {
      showLoading: false,
      showError: false,
    })

    if (selectedId) {
      await loadDetail(selectedId, {
        showLoading: false,
        showError: false,
      })
    }
  }, 15000)

  async function handleCreate(event) {
    event.preventDefault()
    setCreating(true)
    setCreateError(null)

    try {
      const response = await createBlockedSender(token, {
        pattern: createForm.pattern.trim(),
        patternType: normalizeOptional(createForm.patternType) ?? undefined,
        domain: normalizeOptional(createForm.domain),
        reason: createForm.reason,
        status: createForm.status,
      })
      toast.success('Sender blocked')
      setCreateForm(emptyBlockForm())
      setCreateModalOpen(false)
      const nextFilters = { ...filters, offset: 0 }
      setFilters(nextFilters)
      setSelectedId(response.blockedSender.id)
      await loadBlockedSenders(response.blockedSender.id, nextFilters, { showLoading: false, showError: false })
    } catch (error) {
      setCreateError(error)
    } finally {
      setCreating(false)
    }
  }

  async function handleToggleStatus() {
    if (!selectedBlockedSender) {
      return
    }

    setSavingDetail(true)
    setDetailError(null)

    try {
      const nextStatus = selectedBlockedSender.status === 'active' ? 'disabled' : 'active'
      const response = await updateBlockedSender(token, selectedBlockedSender.id, { status: nextStatus })
      setSelectedBlockedSender(response.blockedSender)
      toast.success(nextStatus === 'active' ? 'Block re-enabled' : 'Block disabled')
      await loadBlockedSenders(selectedBlockedSender.id, filters, { showLoading: false, showError: false })
    } catch (error) {
      setDetailError(error)
    } finally {
      setSavingDetail(false)
    }
  }

  async function handleDelete() {
    if (!selectedId) {
      return
    }

    setDeleting(true)
    setDetailError(null)

    try {
      await deleteBlockedSender(token, selectedId)
      toast.success('Block rule deleted')
      setSelectedId(null)
      setSelectedBlockedSender(null)
      await loadBlockedSenders(null, filters, { showLoading: false, showError: false })
    } catch (error) {
      setDetailError(error)
    } finally {
      setDeleting(false)
    }
  }

  function handleSearchSubmit(event) {
    event.preventDefault()
    setFilters((current) => ({ ...current, q: searchDraft.trim(), offset: 0 }))
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <Panel tone="ember" className="shrink-0 p-3 sm:p-4">
        <div className="toolbar">
          <AutoRefreshButton onClick={refreshNow} />
          <Badge tone="neutral">{blockedSenders.length} / {totalBlockedSenders} rules</Badge>
          {loadingList ? <Badge tone="warning">Syncing…</Badge> : null}
          <form onSubmit={handleSearchSubmit} className="min-w-[200px] flex-1">
            <Input
              className={HEADER_INPUT_CLASS}
              value={searchDraft}
              onChange={(event) => setSearchDraft(event.target.value)}
              placeholder="Search sender…"
            />
          </form>
          <Select
            className={HEADER_SELECT_CLASS}
            value={filters.patternType}
            onChange={(event) => setFilters((current) => ({ ...current, patternType: event.target.value, offset: 0 }))}
          >
            <option value="">All types</option>
            <option value="email">Specific email</option>
            <option value="domain">Entire domain</option>
          </Select>
          <Select
            className={HEADER_SELECT_CLASS}
            value={filters.scope}
            onChange={(event) => setFilters((current) => ({ ...current, scope: event.target.value, offset: 0 }))}
          >
            <option value="">All scopes</option>
            <option value="global">System-wide</option>
            <option value="domain">Per domain</option>
          </Select>
          <Select
            className={HEADER_SELECT_CLASS}
            value={filters.status}
            onChange={(event) => setFilters((current) => ({ ...current, status: event.target.value, offset: 0 }))}
          >
            <option value="">All statuses</option>
            {STATUS_OPTIONS.map((status) => <option key={status} value={status}>{status}</option>)}
          </Select>
          <CompactPagination
            className="ml-auto"
            total={totalBlockedSenders}
            count={blockedSenders.length}
            offset={filters.offset}
            limit={filters.limit}
            onLimitChange={(limit) => setFilters((current) => ({ ...current, limit, offset: 0 }))}
            onPrev={() => setFilters((current) => ({ ...current, offset: Math.max(0, current.offset - current.limit) }))}
            onNext={() => setFilters((current) => ({ ...current, offset: current.offset + current.limit }))}
          />
          <Button
            size="sm"
            icon={Ban}
            onClick={() => {
              setCreateError(null)
              setCreateForm(emptyBlockForm())
              setCreateModalOpen(true)
            }}
          >
            Block Sender
          </Button>
        </div>
      </Panel>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <Panel tone="slate">
        {blockedSenders.length ? (
          <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
            <div className="hidden grid-cols-[minmax(0,1.2fr)_220px_180px_170px] items-center gap-4 border-b border-white/5 bg-white/[0.03] px-5 py-3 text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400 lg:grid">
              <p>Sender</p>
              <p>Scope / Type</p>
              <p>Blocked</p>
              <p className="text-right">Updated</p>
            </div>

            <div className="grid gap-0">
              {blockedSenders.map((item) => {
                const isActive = selectedId === item.id

                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setSelectedId(item.id)}
                    className={cn(
                      'grid w-full gap-4 border-b border-white/5 px-4 py-4 text-left transition-all duration-300 last:border-none sm:px-5',
                      'lg:grid-cols-[minmax(0,1.2fr)_220px_180px_170px] lg:items-center',
                      isActive
                        ? 'bg-[#38bdf8]/10'
                        : 'bg-transparent hover:bg-white/5',
                    )}
                  >
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Ban className="h-4 w-4 text-red-400" />
                        <p className="truncate font-semibold text-white">
                          {item.patternType === 'domain' ? `*@${item.pattern}` : item.pattern}
                        </p>
                        <Badge tone={item.status === 'active' ? 'danger' : 'neutral'}>{item.status}</Badge>
                      </div>
                      <p className="text-sm leading-6 text-gray-400">{truncate(item.reason || 'No reason given', 110)}</p>
                    </div>

                    <div className="flex flex-wrap items-center gap-2">
                      <Badge tone="accent">{patternTypeLabel(item.patternType)}</Badge>
                      <Badge tone="neutral">{item.domain || 'System-wide'}</Badge>
                    </div>

                    <div className="grid gap-1 text-sm text-white">
                      <p className="font-semibold">{item.matchCount} emails</p>
                      <p className="text-xs text-gray-400">
                        {item.lastMatchedAt ? formatDateTime(item.lastMatchedAt) : 'No blocks yet'}
                      </p>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-sm text-gray-400 lg:justify-end">
                      <p className="font-medium">{formatDateTime(item.updatedAt)}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <EmptyState
            title="No blocked senders"
          />
        )}
        </Panel>
      </div>

      <BlockCreateModal
        open={createModalOpen}
        form={createForm}
        domains={domainOptions}
        saving={creating}
        error={createError}
        onChange={setCreateForm}
        onSubmit={handleCreate}
        onClose={() => {
          setCreateModalOpen(false)
          setCreateError(null)
        }}
      />

      <BlockDetailModal
        open={Boolean(selectedId)}
        blockedSender={selectedBlockedSender}
        loading={loadingDetail}
        saving={savingDetail}
        deleting={deleting}
        error={detailError}
        onToggleStatus={handleToggleStatus}
        onDelete={handleDelete}
        onClose={() => {
          setSelectedId(null)
          setSelectedBlockedSender(null)
          setDetailError(null)
        }}
      />
    </div>
  )
}
