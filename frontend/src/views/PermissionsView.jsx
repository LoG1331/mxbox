import { useEffect, useState } from 'react'
import { ShieldPlus, Trash2 } from 'lucide-react'
import { toast } from 'react-hot-toast'
import {
  createPermission,
  deletePermission,
  getPermission,
  listDomains,
  listPermissions,
} from '../lib/api.js'
import { cn, findIssueMessage, formatApiError, formatDateTime, getPermissionScopeLabel, normalizeOptional } from '../lib/format.js'
import { clampOffset } from '../lib/pagination.js'
import { AutoRefreshButton, Badge, Button, CompactPagination, EmptyState, Field, FormError, ModalShell, Panel, Select } from '../components/ui.jsx'
import UserPicker from '../components/UserPicker.jsx'
import { useAutoRefresh } from '../hooks/useAutoRefresh.js'

const COMPACT_INPUT_CLASS = 'min-h-[44px] text-sm'
const HEADER_INPUT_CLASS = 'w-auto min-w-[160px] text-sm'
const CREATE_HANDLED_FIELDS = ['userId', 'username', 'domain']

function emptyPermissionCreateForm() {
  return {
    userId: '',
    domain: '',
  }
}

function PermissionCreateModal({ open, token, domains, form, saving, error, onChange, onSubmit, onClose }) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Grant Permission"
      tone="ocean"
      size="md"
    >
      <form className="space-y-4" onSubmit={onSubmit}>
        <FormError error={error} handledFields={CREATE_HANDLED_FIELDS} />
        <UserPicker
          token={token}
          value={form.userId}
          onChange={(userId) => onChange((current) => ({ ...current, userId }))}
          error={findIssueMessage(error, ['userId', 'username'])}
        />
        <Field
          label="Domain"
          error={findIssueMessage(error, 'domain')}
        >
          <Select
            className={COMPACT_INPUT_CLASS}
            value={form.domain}
            invalid={Boolean(findIssueMessage(error, 'domain'))}
            onChange={(event) => onChange((current) => ({ ...current, domain: event.target.value }))}
          >
            <option value="">Select domain</option>
            {domains.map((domain) => (
              <option key={domain.domain} value={domain.domain}>{domain.domain}</option>
            ))}
          </Select>
        </Field>
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/5 pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" icon={ShieldPlus} loading={saving}>Grant</Button>
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

function PermissionDetailModal({
  open,
  permission,
  loading,
  deleting,
  error,
  onDelete,
  onClose,
}) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={permission ? getPermissionScopeLabel(permission) : 'Permission Details'}
      tone="sage"
      size="lg"
      action={loading ? <Badge tone="warning">Syncing…</Badge> : null}
    >
      {permission ? (
        <div className="space-y-5">
          <FormError error={error} />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <DetailStatCard label="User">@{permission.user.username}</DetailStatCard>
            <DetailStatCard label="Granted By">{permission.grantedBy?.username || permission.grantedBy?.label || 'Unknown'}</DetailStatCard>
            <DetailStatCard label="Created">{formatDateTime(permission.createdAt)}</DetailStatCard>
            <DetailStatCard label="Updated">{formatDateTime(permission.updatedAt)}</DetailStatCard>
          </div>

          <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/5 pt-4">
            <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
            <Button type="button" variant="danger" icon={Trash2} loading={deleting} onClick={onDelete}>Delete</Button>
          </div>
        </div>
      ) : (
        <div className="rounded-xl border border-dashed border-white/10 bg-white/5 px-5 py-10 text-sm text-gray-400">
          Loading permission details...
        </div>
      )}
    </ModalShell>
  )
}

export default function PermissionsView({ token }) {
  const [filters, setFilters] = useState({
    userId: '',
    domain: '',
    limit: 50,
    offset: 0,
  })
  const [domainOptions, setDomainOptions] = useState([])
  const [permissions, setPermissions] = useState([])
  const [totalPermissions, setTotalPermissions] = useState(0)
  const [loadingPermissions, setLoadingPermissions] = useState(false)
  const [selectedPermissionId, setSelectedPermissionId] = useState(null)
  const [selectedPermission, setSelectedPermission] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [creatingPermission, setCreatingPermission] = useState(false)
  const [deletingPermission, setDeletingPermission] = useState(false)
  const [createForm, setCreateForm] = useState(emptyPermissionCreateForm())
  const [createError, setCreateError] = useState(null)
  const [detailError, setDetailError] = useState(null)

  async function loadOptions({ showError = true } = {}) {
    try {
      const domainsResponse = await listDomains(token, { limit: 200, offset: 0 })
      setDomainOptions(domainsResponse.domains)
    } catch (error) {
      if (showError) {
        toast.error(formatApiError(error))
      }
    }
  }

  async function loadPermissions(preferredPermissionId = selectedPermissionId, activeFilters = filters, { showLoading = true, showError = true } = {}) {
    if (showLoading) {
      setLoadingPermissions(true)
    }

    try {
      const response = await listPermissions(token, activeFilters)
      if (!response.permissions.length && activeFilters.offset > 0 && response.total <= activeFilters.offset) {
        setFilters((current) => ({
          ...current,
          offset: clampOffset(current.offset, response.total, current.limit),
        }))
      }

      setPermissions(response.permissions)
      setTotalPermissions(response.total)

      if (!response.permissions.length) {
        setSelectedPermissionId(null)
        setSelectedPermission(null)
        return response
      }

      if (preferredPermissionId && !response.permissions.some((permission) => permission.id === preferredPermissionId)) {
        setSelectedPermissionId(null)
        setSelectedPermission(null)
      }

      return response
    } catch (error) {
      if (showError) {
        toast.error(formatApiError(error))
      }
      return null
    } finally {
      setLoadingPermissions(false)
    }
  }

  async function loadPermissionDetail(permissionId = selectedPermissionId, { showLoading = true, showError = true } = {}) {
    if (!permissionId) {
      return null
    }

    if (showLoading) {
      setLoadingDetail(true)
    }

    try {
      const response = await getPermission(token, permissionId)
      setSelectedPermission(response.permission)
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
    void loadOptions({ showError: false })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token])

  useEffect(() => {
    void loadPermissions(null, filters)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token, filters.userId, filters.domain, filters.limit, filters.offset])

  useEffect(() => {
    if (!selectedPermissionId) {
      setSelectedPermission(null)
      return
    }

    void loadPermissionDetail(selectedPermissionId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedPermissionId, token])

  const refreshNow = useAutoRefresh(async () => {
    await loadPermissions(selectedPermissionId, filters, {
      showLoading: false,
      showError: false,
    })

    await loadOptions({ showError: false })

    if (selectedPermissionId) {
      await loadPermissionDetail(selectedPermissionId, {
        showLoading: false,
        showError: false,
      })
    }
  }, 10000)

  function openCreateModal() {
    setCreateError(null)
    setCreateForm(emptyPermissionCreateForm())
    setCreateModalOpen(true)
  }

  async function handleCreate(event) {
    event.preventDefault()
    setCreatingPermission(true)
    setCreateError(null)

    try {
      const response = await createPermission(token, {
        userId: normalizeOptional(createForm.userId),
        domain: normalizeOptional(createForm.domain),
      })
      toast.success('Permission granted')
      setCreateForm(emptyPermissionCreateForm())
      setCreateModalOpen(false)
      setSelectedPermissionId(response.permission.id)
      const nextFilters = {
        ...filters,
        offset: 0,
      }
      setFilters(nextFilters)
      await loadPermissions(response.permission.id, nextFilters, { showLoading: false, showError: false })
      await loadPermissionDetail(response.permission.id, { showLoading: false, showError: false })
    } catch (error) {
      setCreateError(error)
    } finally {
      setCreatingPermission(false)
    }
  }

  async function handleDelete() {
    if (!selectedPermissionId) {
      return
    }

    setDeletingPermission(true)
    setDetailError(null)

    try {
      await deletePermission(token, selectedPermissionId)
      toast.success('Permission deleted')
      setSelectedPermissionId(null)
      setSelectedPermission(null)
      await loadPermissions(null, filters, { showLoading: false, showError: false })
    } catch (error) {
      setDetailError(error)
    } finally {
      setDeletingPermission(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <Panel tone="ocean" className="shrink-0 p-3 sm:p-4">
        <div className="toolbar text-sm">
          <AutoRefreshButton onClick={refreshNow} />
          <Badge tone="neutral">{permissions.length} / {totalPermissions} permissions</Badge>
          {loadingPermissions ? <Badge tone="warning">Syncing…</Badge> : null}
          <div className="min-w-[200px] flex-1">
            <UserPicker
              token={token}
              value={filters.userId}
              label={null}
              placeholder="All users"
              onChange={(userId) => setFilters((current) => ({ ...current, userId, offset: 0 }))}
            />
          </div>
          <Select
            className={HEADER_INPUT_CLASS}
            value={filters.domain}
            onChange={(event) => setFilters((current) => ({ ...current, domain: event.target.value, offset: 0 }))}
          >
            <option value="">All domains</option>
            {domainOptions.map((domain) => (
              <option key={domain.domain} value={domain.domain}>{domain.domain}</option>
            ))}
          </Select>
          <CompactPagination
            className="ml-auto"
            total={totalPermissions}
            count={permissions.length}
            offset={filters.offset}
            limit={filters.limit}
            onLimitChange={(limit) => setFilters((current) => ({ ...current, limit, offset: 0 }))}
            onPrev={() => setFilters((current) => ({ ...current, offset: Math.max(0, current.offset - current.limit) }))}
            onNext={() => setFilters((current) => ({ ...current, offset: current.offset + current.limit }))}
          />
          <Button size="sm" icon={ShieldPlus} onClick={openCreateModal}>
            Grant
          </Button>
        </div>
      </Panel>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {permissions.length ? (
          <div className="overflow-hidden rounded-xl border border-white/10 bg-white/5">
            <div className="hidden grid-cols-[minmax(0,1.2fr)_minmax(220px,0.8fr)_170px] items-center gap-4 border-b border-white/5 bg-white/[0.03] px-5 py-3 text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400 lg:grid">
              <p>Domain</p>
              <p>User</p>
              <p className="text-right">Updated</p>
            </div>

            <div className="grid gap-0">
              {permissions.map((permission) => {
                const isActive = selectedPermissionId === permission.id

                return (
                  <button
                    key={permission.id}
                    type="button"
                    onClick={() => setSelectedPermissionId(permission.id)}
                    className={cn(
                      'w-full border-b border-white/5 px-4 py-4 text-left transition-all duration-300 last:border-none sm:px-5',
                      isActive
                        ? 'bg-[#38bdf8]/10'
                        : 'hover:bg-white/5',
                    )}
                  >
                    <div className="space-y-3 lg:hidden">
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate text-base font-semibold text-white">{getPermissionScopeLabel(permission)}</p>
                        </div>
                      </div>

                      <div className="grid gap-2 sm:grid-cols-2">
                        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
                          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-400">User</p>
                          <p className="mt-1 truncate text-sm font-semibold text-white">@{permission.user.username}</p>
                        </div>
                        <div className="rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
                          <p className="text-[11px] font-bold uppercase tracking-[0.16em] text-gray-400">Granted By</p>
                          <p className="mt-1 truncate text-sm font-semibold text-white">
                            {permission.grantedBy?.username ? `@${permission.grantedBy.username}` : permission.grantedBy?.label || 'Unknown'}
                          </p>
                        </div>
                      </div>

                      <p className="text-xs font-medium text-gray-400">
                        Updated {formatDateTime(permission.updatedAt)}
                      </p>
                    </div>

                    <div className="hidden lg:grid lg:grid-cols-[minmax(0,1.2fr)_minmax(220px,0.8fr)_170px] lg:items-center lg:gap-4">
                      <div className="min-w-0 space-y-2">
                        <div className="flex flex-wrap items-center gap-2">
                          <p className="font-semibold text-white">{getPermissionScopeLabel(permission)}</p>
                        </div>
                      </div>

                      <div className="grid gap-2 text-sm text-white">
                        <div className="min-w-0">
                          <p className="truncate font-medium">@{permission.user.username}</p>
                          <p className="text-xs text-gray-400">
                            {permission.grantedBy?.username ? `Granted by @${permission.grantedBy.username}` : 'Unknown'}
                          </p>
                        </div>
                      </div>

                      <div className="flex items-center justify-end gap-2 text-sm text-gray-400">
                        <p className="font-medium">{formatDateTime(permission.updatedAt)}</p>
                      </div>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <Panel tone="slate">
            <EmptyState
              title="No permissions"
              description="Adjust filters or grant a new permission."
            />
          </Panel>
        )}
      </div>

      <PermissionCreateModal
        open={createModalOpen}
        token={token}
        domains={domainOptions}
        form={createForm}
        saving={creatingPermission}
        error={createError}
        onChange={setCreateForm}
        onSubmit={handleCreate}
        onClose={() => {
          setCreateModalOpen(false)
          setCreateError(null)
        }}
      />

      <PermissionDetailModal
        open={Boolean(selectedPermissionId)}
        permission={selectedPermission}
        loading={loadingDetail}
        deleting={deletingPermission}
        error={detailError}
        onDelete={handleDelete}
        onClose={() => {
          setSelectedPermissionId(null)
          setSelectedPermission(null)
          setDetailError(null)
        }}
      />
    </div>
  )
}
