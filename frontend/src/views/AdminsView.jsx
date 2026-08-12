import { useDeferredValue, useEffect, useState } from 'react'
import { Crown, ShieldPlus, Trash2 } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { grantAdmin, listAdmins, revokeAdmin } from '../lib/api.js'
import { findIssueMessage, formatApiError, formatDateTime } from '../lib/format.js'
import { clampOffset } from '../lib/pagination.js'
import DataTable from '../components/DataTable.jsx'
import { AutoRefreshButton, Badge, Button, CompactPagination, FormError, Input, ModalShell, Panel } from '../components/ui.jsx'
import UserPicker from '../components/UserPicker.jsx'
import { useAutoRefresh } from '../hooks/useAutoRefresh.js'

const COMPACT_INPUT_CLASS = 'px-4 py-2.5 text-sm'
const GRANT_HANDLED_FIELDS = ['userId', 'username']

function GrantAdminModal({ open, token, form, saving, error, onChange, onSubmit, onClose }) {
  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Grant Admin"
      tone="ocean"
      size="md"
    >
      <form className="grid gap-5" onSubmit={onSubmit}>
        <FormError error={error} handledFields={GRANT_HANDLED_FIELDS} />
        <UserPicker
          token={token}
          value={form.userId}
          onChange={(userId) => onChange((current) => ({ ...current, userId }))}
          label="User"
          error={findIssueMessage(error, GRANT_HANDLED_FIELDS)}
        />
        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/5 pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Close</Button>
          <Button type="submit" icon={ShieldPlus} loading={saving} disabled={!form.userId}>Grant Admin</Button>
        </div>
      </form>
    </ModalShell>
  )
}

export default function AdminsView({ token }) {
  const [admins, setAdmins] = useState([])
  const [totalAdmins, setTotalAdmins] = useState(0)
  const [loadingAdmins, setLoadingAdmins] = useState(false)
  const [filters, setFilters] = useState({
    q: '',
    limit: 50,
    offset: 0,
  })
  const deferredQuery = useDeferredValue(filters.q)
  const [grantModalOpen, setGrantModalOpen] = useState(false)
  const [grantingAdmin, setGrantingAdmin] = useState(false)
  const [grantError, setGrantError] = useState(null)
  const [grantForm, setGrantForm] = useState({
    userId: '',
  })

  async function loadAdmins(
    query = {
      q: deferredQuery,
      limit: filters.limit,
      offset: filters.offset,
    },
    { showLoading = true, showError = true } = {},
  ) {
    if (showLoading) {
      setLoadingAdmins(true)
    }

    try {
      const response = await listAdmins(token, query)
      if (!response.admins.length && query.offset > 0 && response.total <= query.offset) {
        setFilters((current) => ({
          ...current,
          offset: clampOffset(current.offset, response.total, current.limit),
        }))
      }

      setAdmins(response.admins)
      setTotalAdmins(response.total)
    } catch (error) {
      if (showError) {
        toast.error(formatApiError(error))
      }
    } finally {
      setLoadingAdmins(false)
    }
  }

  useEffect(() => {
    void loadAdmins({
      q: deferredQuery,
      limit: filters.limit,
      offset: filters.offset,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredQuery, filters.limit, filters.offset, token])

  const refreshNow = useAutoRefresh(async () => {
    await loadAdmins({
      q: deferredQuery,
      limit: filters.limit,
      offset: filters.offset,
    }, {
      showLoading: false,
      showError: false,
    })
  }, 10000)

  async function handleGrant(event) {
    event.preventDefault()
    setGrantingAdmin(true)
    setGrantError(null)

    try {
      await grantAdmin(token, {
        userId: grantForm.userId || undefined,
      })
      toast.success('Admin granted')
      setGrantForm({
        userId: '',
      })
      setGrantModalOpen(false)
      setFilters((current) => ({ ...current, offset: 0 }))
      await loadAdmins({
        q: deferredQuery,
        limit: filters.limit,
        offset: 0,
      })
    } catch (error) {
      setGrantError(error)
    } finally {
      setGrantingAdmin(false)
    }
  }

  async function handleRevoke(userId) {
    try {
      await revokeAdmin(token, userId)
      toast.success('Admin revoked')
      await loadAdmins({
        q: deferredQuery,
        limit: filters.limit,
        offset: filters.offset,
      })
    } catch (error) {
      toast.error(formatApiError(error))
    }
  }

  const columns = [
    {
      key: 'username',
      label: 'Admin',
      render: (admin) => (
        <div className="space-y-1">
          <div className="flex items-center gap-2">
            <Crown className="h-4 w-4 text-[#38bdf8]" />
            <p className="font-semibold text-white">@{admin.username}</p>
          </div>
          <p className="text-xs text-gray-400">{admin.displayName || 'No display name'}</p>
        </div>
      ),
    },
    {
      key: 'grantedAt',
      label: 'Granted',
      render: (admin) => formatDateTime(admin.grantedAt),
    },
    {
      key: 'actions',
      label: 'Actions',
      render: (admin) => (
        <Button
          variant="ghost"
          size="sm"
          icon={Trash2}
          onClick={(event) => {
            event.stopPropagation()
            handleRevoke(admin.id)
          }}
        >
          Remove
        </Button>
      ),
    },
  ]

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="shrink-0 rounded-xl border border-white/10 bg-white/5 p-3">
        <div className="toolbar text-sm">
          <div className="flex-1 min-w-[200px]">
            <Input
              className={COMPACT_INPUT_CLASS}
              value={filters.q}
              onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value, offset: 0 }))}
              placeholder="@admin"
            />
          </div>
          <AutoRefreshButton onClick={refreshNow} />
          {loadingAdmins ? <Badge tone="warning">Syncing…</Badge> : null}
          <CompactPagination
            className="ml-auto"
            total={totalAdmins}
            count={admins.length}
            offset={filters.offset}
            limit={filters.limit}
            onLimitChange={(limit) => setFilters((current) => ({ ...current, limit, offset: 0 }))}
            onPrev={() => setFilters((current) => ({ ...current, offset: Math.max(0, current.offset - current.limit) }))}
            onNext={() => setFilters((current) => ({ ...current, offset: current.offset + current.limit }))}
          />
          <Button
            size="sm"
            icon={ShieldPlus}
            onClick={() => {
              setGrantError(null)
              setGrantForm({ userId: '' })
              setGrantModalOpen(true)
            }}
          >
            Grant Admin
          </Button>
        </div>
      </div>

      <Panel tone="slate" className="min-h-0 flex-1 overflow-y-auto">
        <DataTable
          columns={columns}
          rows={admins}
          emptyTitle="No admins"
          emptyDescription="Grant the first admin."
        />
      </Panel>

      <GrantAdminModal
        open={grantModalOpen}
        token={token}
        form={grantForm}
        saving={grantingAdmin}
        error={grantError}
        onChange={setGrantForm}
        onSubmit={handleGrant}
        onClose={() => {
          setGrantModalOpen(false)
          setGrantError(null)
        }}
      />
    </div>
  )
}
