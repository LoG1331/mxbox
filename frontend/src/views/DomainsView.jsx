import { useEffect, useState } from 'react'
import { Globe2, Plus, Trash2 } from 'lucide-react'
import { toast } from 'react-hot-toast'
import {
  createDomain,
  deleteDomain,
  getDomain,
  listDomains,
  updateDomain,
} from '../lib/api.js'
import { cn, findIssueMessage, formatApiError, formatDateTime, truncate } from '../lib/format.js'
import { clampOffset } from '../lib/pagination.js'
import { AutoRefreshButton, Badge, Button, Checkbox, CompactPagination, EmptyState, Field, FormError, Input, ModalShell, Panel, TextArea } from '../components/ui.jsx'
import { useAutoRefresh } from '../hooks/useAutoRefresh.js'

const CREATE_HANDLED_FIELDS = ['domain', 'description', 'isDefault']

function emptyDomainForm() {
  return {
    domain: '',
    description: '',
    isDefault: false,
  }
}

function DomainToggleCard({ title, checked, onChange }) {
  return (
    <div
      className={cn(
        'rounded-xl border px-4 py-3.5 transition-colors duration-200',
        checked
          ? 'border-[#38bdf8]/30 bg-[#38bdf8]/10'
          : 'border-white/10 bg-white/5 hover:border-white/20',
      )}
    >
      <Checkbox
        label={title}
        checked={checked}
        onChange={onChange}
        className="font-semibold text-white"
      />
    </div>
  )
}

function DomainCreateModal({ open, form, saving, error, onChange, onSubmit, onClose }) {
  const domainError = findIssueMessage(error, 'domain')

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Create Domain"
      tone="sand"
      size="md"
    >
      <form className="space-y-6" onSubmit={onSubmit}>
        <FormError error={error} handledFields={CREATE_HANDLED_FIELDS} />

        <div className="space-y-4">
          <Field label="Domain" error={domainError}>
            <Input
              invalid={Boolean(domainError)}
              value={form.domain}
              onChange={(event) => onChange((current) => ({ ...current, domain: event.target.value }))}
              placeholder="example.com"
              autoFocus
            />
          </Field>

          <Field label="Description" error={findIssueMessage(error, 'description')}>
            <TextArea rows={3} value={form.description} onChange={(event) => onChange((current) => ({ ...current, description: event.target.value }))} placeholder="Short note for this domain" />
          </Field>
        </div>

        <DomainToggleCard
          title="Default Domain"
          checked={form.isDefault}
          onChange={(event) => onChange((current) => ({ ...current, isDefault: event.target.checked }))}
        />

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/5 pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" icon={Plus} loading={saving}>Create Domain</Button>
        </div>
      </form>
    </ModalShell>
  )
}

function DetailStatCard({ label, children }) {
  return (
    <div className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl transition-all duration-300 hover:border-white/20">
      <p className="text-xs font-bold uppercase tracking-[0.16em] text-gray-400">{label}</p>
      <p className="mt-2 truncate text-sm font-semibold text-white">{children}</p>
    </div>
  )
}

function DomainDetailModal({
  open,
  domain,
  loading,
  canDelete,
  deletingDomain,
  error,
  subdomainsValue,
  savingSubdomains,
  onSubdomainsChange,
  onSaveSubdomains,
  onDeleteDomain,
  onClose,
}) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={domain ? domain.domain : 'Domain Details'}
      tone="slate"
      size="lg"
      action={domain ? (
        <div className="flex flex-wrap items-center gap-2">
          {loading ? <Badge tone="warning">Syncing…</Badge> : null}
          {domain.isDefault ? <Badge tone="accent">Default</Badge> : null}
        </div>
      ) : loading ? <Badge tone="warning">Syncing…</Badge> : null}
    >
      {domain ? (
        <div className="space-y-5">
          <FormError error={error} />

          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <DetailStatCard label="Email">{domain.counts.emails}</DetailStatCard>
            <DetailStatCard label="Permissions">{domain.counts.permissionCount}</DetailStatCard>
            <DetailStatCard label="Created">{formatDateTime(domain.createdAt)}</DetailStatCard>
            <DetailStatCard label="Updated">{formatDateTime(domain.updatedAt)}</DetailStatCard>
          </div>

          <section className="rounded-xl border border-white/10 bg-white/5 p-4 backdrop-blur-xl sm:p-5">
            <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-400">Description</p>
              <p className="mt-2 text-sm leading-6 text-gray-300">{domain.description || 'No description'}</p>
            </div>

            <div className="mt-4 rounded-xl border border-white/10 bg-white/5 px-4 py-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-400">Allowed Subdomains</p>
                {domain.allowedSubdomains === null
                  ? <Badge tone="success">Wildcard — every subdomain</Badge>
                  : domain.allowedSubdomains.length
                    ? <Badge tone="warning">{domain.allowedSubdomains.length} restricted</Badge>
                    : <Badge tone="danger">Apex only</Badge>}
              </div>
              <p className="mt-2 text-xs leading-5 text-gray-400">
                Leave empty to accept mail for every subdomain. A comma-separated list restricts the domain
                to those subdomains (each entry also covers its own subdomains).
              </p>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <Input
                  className="min-h-[44px] flex-1 px-4 py-2.5 text-sm"
                  value={subdomainsValue}
                  onChange={onSubdomainsChange}
                  placeholder="crm, ops, x.crm"
                  disabled={!canDelete || savingSubdomains}
                />
                <Button type="button" size="sm" loading={savingSubdomains} onClick={onSaveSubdomains} disabled={!canDelete}>
                  Save
                </Button>
              </div>
            </div>

            <div className="mt-4 flex flex-wrap items-center justify-end gap-2 border-t border-white/5 pt-4">
              <Button type="button" size="sm" variant="ghost" onClick={onClose}>Close</Button>
              {canDelete ? <Button type="button" size="sm" variant="danger" icon={Trash2} loading={deletingDomain} onClick={onDeleteDomain}>Delete Domain</Button> : null}
            </div>
          </section>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-white/10 bg-white/5 px-5 py-10 text-sm text-gray-400">
          Loading domain details...
        </div>
      )}
    </ModalShell>
  )
}

export default function DomainsView({ token, account, accessibleDomains }) {
  const [domains, setDomains] = useState([])
  const [totalDomains, setTotalDomains] = useState(0)
  const [loadingDomains, setLoadingDomains] = useState(false)
  const [selectedDomainName, setSelectedDomainName] = useState(null)
  const [selectedDomain, setSelectedDomain] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [creatingDomain, setCreatingDomain] = useState(false)
  const [deletingDomain, setDeletingDomain] = useState(false)
  const [createForm, setCreateForm] = useState(emptyDomainForm())
  const [createError, setCreateError] = useState(null)
  const [detailError, setDetailError] = useState(null)
  const [subdomainsValue, setSubdomainsValue] = useState('')
  const [savingSubdomains, setSavingSubdomains] = useState(false)
  const [filters, setFilters] = useState({
    limit: 50,
    offset: 0,
  })

  async function loadDomains(
    preferredDomain = selectedDomainName,
    query = filters,
    { showLoading = true, showError = true } = {},
  ) {
    if (showLoading) {
      setLoadingDomains(true)
    }

    try {
      const response = await listDomains(token, query)
      if (!response.domains.length && query.offset > 0 && response.total <= query.offset) {
        setFilters((current) => ({
          ...current,
          offset: clampOffset(current.offset, response.total, current.limit),
        }))
      }

      setDomains(response.domains)
      setTotalDomains(response.total)

      if (!response.domains.length) {
        setSelectedDomainName(null)
        setSelectedDomain(null)
        return response
      }

      if (preferredDomain && !response.domains.some((domain) => domain.domain === preferredDomain)) {
        setSelectedDomainName(null)
        setSelectedDomain(null)
      }

      return response
    } catch (error) {
      if (showError) {
        toast.error(formatApiError(error))
      }
      return null
    } finally {
      setLoadingDomains(false)
    }
  }

  async function loadDomainDetail(domainName = selectedDomainName, { showLoading = true, showError = true } = {}) {
    if (!domainName) {
      return null
    }

    if (showLoading) {
      setLoadingDetail(true)
    }

    try {
      const domainResponse = await getDomain(token, domainName)
      setSelectedDomain(domainResponse.domain)
      setSubdomainsValue((domainResponse.domain.allowedSubdomains || []).join(', '))
      return domainResponse
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
    void loadDomains(null, filters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.limit, filters.offset, token])

  useEffect(() => {
    if (!selectedDomainName) {
      setSelectedDomain(null)
      return
    }

    void loadDomainDetail(selectedDomainName)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedDomainName, token])

  const refreshNow = useAutoRefresh(async () => {
    await loadDomains(selectedDomainName, filters, {
      showLoading: false,
      showError: false,
    })

    if (selectedDomainName) {
      await loadDomainDetail(selectedDomainName, {
        showLoading: false,
        showError: false,
      })
    }
  }, 10000)

  async function handleCreateDomain(event) {
    event.preventDefault()
    setCreatingDomain(true)
    setCreateError(null)

    try {
      const response = await createDomain(token, createForm)
      toast.success('Domain created')
      setCreateForm(emptyDomainForm())
      setCreateModalOpen(false)
      setSelectedDomainName(response.domain.domain)
      const nextFilters = {
        ...filters,
        offset: 0,
      }
      setFilters(nextFilters)
      await loadDomains(response.domain.domain, nextFilters, { showLoading: false, showError: false })
      await loadDomainDetail(response.domain.domain, { showLoading: false, showError: false })
    } catch (error) {
      setCreateError(error)
    } finally {
      setCreatingDomain(false)
    }
  }

  async function handleSaveSubdomains() {
    if (!selectedDomainName) {
      return
    }

    setSavingSubdomains(true)
    setDetailError(null)

    const raw = subdomainsValue.trim()
    const allowedSubdomains = raw
      ? raw.split(',').map((item) => item.trim()).filter(Boolean)
      : null

    try {
      const response = await updateDomain(token, selectedDomainName, { allowedSubdomains })
      setSelectedDomain(response.domain)
      setSubdomainsValue((response.domain.allowedSubdomains || []).join(', '))
      toast.success(response.domain.allowedSubdomains === null
        ? 'Subdomain restriction removed — wildcard enabled'
        : 'Allowed subdomains saved')
      await loadDomains(selectedDomainName, filters, { showLoading: false, showError: false })
    } catch (error) {
      setDetailError(error)
      toast.error(formatApiError(error))
    } finally {
      setSavingSubdomains(false)
    }
  }

  async function handleDeleteDomain() {
    if (!selectedDomainName) {
      return
    }

    setDeletingDomain(true)
    setDetailError(null)

    try {
      await deleteDomain(token, selectedDomainName)
      toast.success('Domain deleted')
      setSelectedDomainName(null)
      setSelectedDomain(null)
      await loadDomains(null, filters, { showLoading: false, showError: false })
    } catch (error) {
      setDetailError(error)
    } finally {
      setDeletingDomain(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <Panel tone="ocean" className="shrink-0">
        <div className="toolbar">
          <AutoRefreshButton onClick={refreshNow} />
          <Badge tone="neutral">{accessibleDomains.length} granted</Badge>
          <Badge tone="neutral">{domains.length} / {totalDomains} domains</Badge>
          {loadingDomains ? <Badge tone="warning">Syncing…</Badge> : null}
          <div className="ml-auto flex items-center gap-2">
            <CompactPagination
              total={totalDomains}
              count={domains.length}
              offset={filters.offset}
              limit={filters.limit}
              onLimitChange={(limit) => setFilters((current) => ({ ...current, limit, offset: 0 }))}
              onPrev={() => setFilters((current) => ({ ...current, offset: Math.max(0, current.offset - current.limit) }))}
              onNext={() => setFilters((current) => ({ ...current, offset: current.offset + current.limit }))}
            />
            {account.isAdmin ? (
              <Button
                size="sm"
                icon={Plus}
                onClick={() => {
                  setCreateError(null)
                  setCreateForm(emptyDomainForm())
                  setCreateModalOpen(true)
                }}
              >
                Create Domain
              </Button>
            ) : null}
          </div>
        </div>
      </Panel>

      <Panel tone="slate" className="min-h-0 flex-1 overflow-y-auto">
        {domains.length ? (
          <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
            <div className="hidden grid-cols-[minmax(0,1.5fr)_220px_170px] items-center gap-4 border-b border-white/5 bg-white/5 px-5 py-3 text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400 lg:grid">
              <p>Domain</p>
              <p>Stats</p>
              <p className="text-right">Updated</p>
            </div>

            <div className="grid gap-0">
              {domains.map((domain) => {
                const isActive = selectedDomainName === domain.domain

                return (
                  <button
                    key={domain.domain}
                    type="button"
                    onClick={() => setSelectedDomainName(domain.domain)}
                    className={cn(
                      'grid w-full gap-4 border-b border-white/5 px-4 py-4 text-left transition-all duration-300 last:border-none sm:px-5',
                      'lg:grid-cols-[minmax(0,1.5fr)_220px_170px] lg:items-center',
                      isActive
                        ? 'bg-[#38bdf8]/10'
                        : 'bg-transparent hover:bg-white/5',
                    )}
                  >
                    <div className="min-w-0 space-y-2">
                      <div className="flex flex-wrap items-center gap-2">
                        <Globe2 className="h-4 w-4 text-[#38bdf8]" />
                        <p className="font-semibold text-white">{domain.domain}</p>
                        {domain.isDefault ? <Badge tone="accent">Default</Badge> : null}
                      </div>
                      <p className="text-sm leading-6 text-gray-400">{truncate(domain.description || 'No description', 110)}</p>
                    </div>

                    <div className="grid gap-2 text-sm text-gray-300">
                      <div className="flex items-center gap-2">
                        <Badge tone="neutral">{domain.counts.emails} emails</Badge>
                        <Badge tone="neutral">{domain.counts.permissionCount} permissions</Badge>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-sm text-gray-400 lg:justify-end">
                      <p className="font-medium">{formatDateTime(domain.updatedAt)}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <EmptyState
            title="No domains to show"
            description="No domains accessible yet."
          />
        )}
      </Panel>

      {account.isAdmin ? (
        <DomainCreateModal
          open={createModalOpen}
          form={createForm}
          saving={creatingDomain}
          error={createError}
          onChange={setCreateForm}
          onSubmit={handleCreateDomain}
          onClose={() => {
            setCreateModalOpen(false)
            setCreateError(null)
          }}
        />
      ) : null}

      <DomainDetailModal
        open={Boolean(selectedDomainName)}
        domain={selectedDomain}
        loading={loadingDetail}
        canDelete={account.isAdmin}
        deletingDomain={deletingDomain}
        error={detailError}
        subdomainsValue={subdomainsValue}
        savingSubdomains={savingSubdomains}
        onSubdomainsChange={(event) => setSubdomainsValue(event.target.value)}
        onSaveSubdomains={() => void handleSaveSubdomains()}
        onDeleteDomain={handleDeleteDomain}
        onClose={() => {
          setSelectedDomainName(null)
          setSelectedDomain(null)
          setDetailError(null)
        }}
      />
    </div>
  )
}
