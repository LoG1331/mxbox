import { useDeferredValue, useEffect, useState } from 'react'
import { KeyRound, RefreshCcw, Search, UserPlus, UserRound } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { createUser, getUserById, listUsers, updateUser } from '../lib/api.js'
import { cn, findIssueMessage, formatApiError, formatDateTime, getPermissionScopeLabel, normalizeOptional } from '../lib/format.js'
import { clampOffset } from '../lib/pagination.js'
import { Badge, Button, CompactPagination, EmptyState, Field, FormError, Input, ModalShell, Panel } from '../components/ui.jsx'
import { useAutoRefresh } from '../hooks/useAutoRefresh.js'

const COMPACT_INPUT_CLASS = 'min-h-[44px] px-4 py-2.5 text-sm'
const HEADER_INPUT_CLASS = 'px-4 py-2.5 text-sm'
const USER_FORM_FIELDS = ['username', 'password', 'displayName', 'telegramId']

function emptyCreateForm() {
  return {
    username: '',
    password: '',
    displayName: '',
    telegramId: '',
  }
}

function UserCreateModal({ open, form, saving, error, onChange, onSubmit, onClose }) {
  const usernameError = findIssueMessage(error, 'username')
  const passwordError = findIssueMessage(error, 'password')
  const telegramIdError = findIssueMessage(error, 'telegramId')

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title="Create User"
      tone="ocean"
      size="md"
    >
      <form className="space-y-6" onSubmit={onSubmit}>
        <FormError error={error} handledFields={USER_FORM_FIELDS} />

        <section className="space-y-3">
          <div className="space-y-4">
            <Field label="Username" error={usernameError}>
              <Input
                autoComplete="username"
                invalid={Boolean(usernameError)}
                value={form.username}
                onChange={(event) => onChange((current) => ({ ...current, username: event.target.value }))}
                placeholder="alice"
                autoFocus
              />
            </Field>

            <Field label="Password" hint="Min 8 characters" error={passwordError}>
              <Input
                type="password"
                autoComplete="new-password"
                invalid={Boolean(passwordError)}
                value={form.password}
                onChange={(event) => onChange((current) => ({ ...current, password: event.target.value }))}
                placeholder="Enter password"
              />
            </Field>
          </div>
        </section>

        <section className="space-y-3">
          <div className="space-y-4">
            <Field label="Display Name" error={findIssueMessage(error, 'displayName')}>
              <Input
                value={form.displayName}
                onChange={(event) => onChange((current) => ({ ...current, displayName: event.target.value }))}
                placeholder="Alice Nguyen"
              />
            </Field>

            <Field label="Telegram ID" error={telegramIdError}>
              <Input
                invalid={Boolean(telegramIdError)}
                value={form.telegramId}
                onChange={(event) => onChange((current) => ({ ...current, telegramId: event.target.value }))}
                placeholder="123456789"
              />
            </Field>
          </div>
        </section>

        <div className="flex flex-wrap items-center justify-end gap-3 border-t border-white/5 pt-4">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" icon={UserPlus} loading={saving}>Create User</Button>
        </div>
      </form>
    </ModalShell>
  )
}

function UserDetailModal({
  open,
  user,
  form,
  saving,
  loading,
  error,
  onChange,
  onSubmit,
  onClose,
}) {
  const usernameError = findIssueMessage(error, 'username')
  const passwordError = findIssueMessage(error, 'password')
  const telegramIdError = findIssueMessage(error, 'telegramId')

  return (
    <ModalShell
      open={open}
      onClose={onClose}
      title={user ? `@${user.username}` : 'User Details'}
      tone="ember"
      size="xl"
      action={user ? (
        <div className="flex flex-wrap items-center gap-2">
          {loading ? <Badge tone="warning">Syncing…</Badge> : null}
          <Badge tone={user.isAdmin ? 'accent' : 'neutral'}>{user.isAdmin ? 'Admin' : 'User'}</Badge>
          <Badge tone="neutral">{user.permissions.length} permissions</Badge>
        </div>
      ) : loading ? <Badge tone="warning">Syncing…</Badge> : null}
    >
      {user ? (
        <div className="space-y-6">
          <section className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400">Display Name</p>
                <p className="mt-1 truncate text-sm font-semibold text-white">{user.displayName || '@' + user.username}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400">Telegram</p>
                <p className="mt-1 truncate text-sm font-semibold text-white">{user.telegramId || 'Not set'}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400">Created</p>
                <p className="mt-1 text-sm font-semibold text-white">{formatDateTime(user.createdAt)}</p>
              </div>
              <div className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
                <p className="text-[11px] font-bold uppercase tracking-[0.18em] text-gray-400">Last Active</p>
                <p className="mt-1 text-sm font-semibold text-white">{formatDateTime(user.lastSeenAt)}</p>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              {user.hasPassword ? <Badge tone="success">Password set</Badge> : <Badge tone="warning">No password</Badge>}
              {user.hasApiKey ? <Badge tone="accent">API key</Badge> : null}
            </div>
          </section>

          <section className="space-y-3">
            <form className="space-y-4 rounded-xl border border-white/10 bg-white/5 p-4 sm:p-5" onSubmit={onSubmit}>
              <FormError error={error} handledFields={USER_FORM_FIELDS} />

              <div className="grid gap-3 md:grid-cols-2">
                <Field label="Username" error={usernameError}>
                  <Input className={COMPACT_INPUT_CLASS} autoComplete="username" invalid={Boolean(usernameError)} value={form.username} onChange={(event) => onChange((current) => ({ ...current, username: event.target.value }))} />
                </Field>
                <Field label="Display Name" error={findIssueMessage(error, 'displayName')}>
                  <Input className={COMPACT_INPUT_CLASS} value={form.displayName} onChange={(event) => onChange((current) => ({ ...current, displayName: event.target.value }))} />
                </Field>
                <Field label="Telegram ID" error={telegramIdError}>
                  <Input className={COMPACT_INPUT_CLASS} invalid={Boolean(telegramIdError)} value={form.telegramId} onChange={(event) => onChange((current) => ({ ...current, telegramId: event.target.value }))} />
                </Field>
                <Field label="New Password" error={passwordError}>
                  <Input
                    className={COMPACT_INPUT_CLASS}
                    type="password"
                    autoComplete="new-password"
                    placeholder="Leave blank to keep"
                    invalid={Boolean(passwordError)}
                    value={form.password}
                    onChange={(event) => onChange((current) => ({ ...current, password: event.target.value }))}
                  />
                </Field>
              </div>

              <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/5 pt-4">
                <Button type="button" size="sm" variant="ghost" onClick={onClose}>Close</Button>
                <Button type="submit" size="sm" loading={saving}>Save</Button>
              </div>
            </form>
          </section>

          <section className="space-y-3">
            {user.permissions.length ? (
              <div className="grid gap-2">
                {user.permissions.map((permission) => (
                  <div key={permission.id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-white/10 bg-white/5 px-3 py-2.5">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">{getPermissionScopeLabel(permission)}</p>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <p className="text-sm text-gray-400">No permissions yet.</p>
            )}
          </section>
        </div>
      ) : (
        <div className="rounded-2xl border border-dashed border-white/10 bg-white/5 px-5 py-10 text-sm text-gray-400">
          Loading user details...
        </div>
      )}
    </ModalShell>
  )
}

export default function UsersView({ token }) {
  const [users, setUsers] = useState([])
  const [totalUsers, setTotalUsers] = useState(0)
  const [loadingUsers, setLoadingUsers] = useState(false)
  const [selectedUserId, setSelectedUserId] = useState(null)
  const [selectedUser, setSelectedUser] = useState(null)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [filters, setFilters] = useState({
    q: '',
    limit: 50,
    offset: 0,
  })
  const deferredQuery = useDeferredValue(filters.q)
  const [telegramLookup, setTelegramLookup] = useState('')
  const [createModalOpen, setCreateModalOpen] = useState(false)
  const [creatingUser, setCreatingUser] = useState(false)
  const [createForm, setCreateForm] = useState(emptyCreateForm())
  const [editForm, setEditForm] = useState({
    username: '',
    password: '',
    displayName: '',
    telegramId: '',
  })
  const [savingUser, setSavingUser] = useState(false)
  const [createError, setCreateError] = useState(null)
  const [editError, setEditError] = useState(null)

  async function loadUsers(
    preferredUserId = selectedUserId,
    query = {
      q: deferredQuery,
      limit: filters.limit,
      offset: filters.offset,
    },
    { showLoading = true, showError = true } = {},
  ) {
    if (showLoading) {
      setLoadingUsers(true)
    }

    try {
      const response = await listUsers(token, query)
      if (!response.users.length && query.offset > 0 && response.total <= query.offset) {
        setFilters((current) => ({
          ...current,
          offset: clampOffset(current.offset, response.total, current.limit),
        }))
      }

      setUsers(response.users)
      setTotalUsers(response.total)

      if (!response.users.length) {
        setSelectedUserId(null)
        setSelectedUser(null)
        return response
      }

      if (preferredUserId && !response.users.some((user) => user.id === preferredUserId)) {
        setSelectedUserId(null)
        setSelectedUser(null)
      }

      return response
    } catch (error) {
      if (showError) {
        toast.error(formatApiError(error))
      }
      return null
    } finally {
      setLoadingUsers(false)
    }
  }

  async function loadSelectedUserDetail(userId = selectedUserId, { showLoading = true, showError = true } = {}) {
    if (!userId) {
      return null
    }

    if (showLoading) {
      setLoadingDetail(true)
    }

    try {
      const response = await getUserById(token, userId)
      setSelectedUser(response.user)
      setEditForm({
        username: response.user.username,
        password: '',
        displayName: response.user.displayName || '',
        telegramId: response.user.telegramId || '',
      })
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
    void loadUsers(null, {
      q: deferredQuery,
      limit: filters.limit,
      offset: filters.offset,
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredQuery, filters.limit, filters.offset, token])

  useEffect(() => {
    if (!selectedUserId) {
      setSelectedUser(null)
      return
    }

    void loadSelectedUserDetail(selectedUserId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedUserId, token])

  const refreshNow = useAutoRefresh(async () => {
    await loadUsers(selectedUserId, {
      q: deferredQuery,
      limit: filters.limit,
      offset: filters.offset,
    }, {
      showLoading: false,
      showError: false,
    })

    if (selectedUserId) {
      await loadSelectedUserDetail(selectedUserId, {
        showLoading: false,
        showError: false,
      })
    }
  }, 10000)

  async function handleCreate(event) {
    event.preventDefault()
    setCreatingUser(true)
    setCreateError(null)

    try {
      const response = await createUser(token, {
        ...createForm,
        telegramId: normalizeOptional(createForm.telegramId),
        generateApiKey: false,
      })
      toast.success('User created')
      setCreateForm(emptyCreateForm())
      setCreateModalOpen(false)
      setSelectedUserId(response.user.id)
      setFilters((current) => ({ ...current, offset: 0 }))
      await loadUsers(response.user.id, {
        q: deferredQuery,
        limit: filters.limit,
        offset: 0,
      }, { showLoading: false, showError: false })
      await loadSelectedUserDetail(response.user.id, { showLoading: false, showError: false })
    } catch (error) {
      setCreateError(error)
    } finally {
      setCreatingUser(false)
    }
  }

  async function handleUpdate(event) {
    event.preventDefault()

    if (!selectedUserId) {
      return
    }

    setSavingUser(true)
    setEditError(null)

    try {
      await updateUser(token, selectedUserId, {
        username: editForm.username,
        displayName: editForm.displayName,
        telegramId: normalizeOptional(editForm.telegramId),
        ...(editForm.password ? { password: editForm.password } : {}),
      })
      toast.success('User updated')
      await loadUsers(selectedUserId, {
        q: deferredQuery,
        limit: filters.limit,
        offset: filters.offset,
      }, { showLoading: false, showError: false })
      await loadSelectedUserDetail(selectedUserId, { showLoading: false, showError: false })
    } catch (error) {
      setEditError(error)
    } finally {
      setSavingUser(false)
    }
  }

  async function handleLookupTelegram(event) {
    event.preventDefault()

    if (!telegramLookup.trim()) {
      toast.error('Enter a Telegram ID to look up')
      return
    }

    try {
      const response = await listUsers(token, {
        telegramId: telegramLookup.trim(),
        limit: 1,
        offset: 0,
      })

      if (!response.users.length) {
        toast.error('No user found for this Telegram ID')
        return
      }

      setSelectedUserId(response.users[0].id)
      toast.success('User found')
    } catch (error) {
      toast.error(formatApiError(error))
    }
  }

  function handleCloseDetail() {
    setSelectedUserId(null)
    setSelectedUser(null)
    setEditError(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <Panel tone="ocean" className="shrink-0 p-3 sm:p-4">
        <div className="toolbar">
          <button
            type="button"
            onClick={refreshNow}
            aria-label="Refresh"
            className="pill w-10 shrink-0 justify-center border-[#38bdf8]/20 bg-[#38bdf8]/10 text-[#38bdf8] transition-all duration-300 hover:bg-[#38bdf8]/20"
          >
            <RefreshCcw className={cn('h-4 w-4', loadingUsers && 'animate-spin')} />
          </button>

          <label className="min-w-[180px] flex-1">
            <span className="sr-only">Search users</span>
            <Input
              className={HEADER_INPUT_CLASS}
              value={filters.q}
              onChange={(event) => setFilters((current) => ({ ...current, q: event.target.value, offset: 0 }))}
              placeholder="Search users — @alice or 100000001"
            />
          </label>

          <form className="flex items-center gap-2" onSubmit={handleLookupTelegram}>
            <label className="w-36">
              <span className="sr-only">Telegram ID</span>
              <Input
                className={HEADER_INPUT_CLASS}
                value={telegramLookup}
                onChange={(event) => setTelegramLookup(event.target.value)}
                placeholder="Telegram ID"
              />
            </label>
            <Button type="submit" size="sm" variant="secondary" icon={Search}>Look Up</Button>
          </form>

          <div className="ml-auto flex flex-wrap items-center gap-2">
            <Badge tone="neutral">{users.length} / {totalUsers} users</Badge>
            <CompactPagination
              total={totalUsers}
              count={users.length}
              offset={filters.offset}
              limit={filters.limit}
              onLimitChange={(limit) => setFilters((current) => ({ ...current, limit, offset: 0 }))}
              onPrev={() => setFilters((current) => ({ ...current, offset: Math.max(0, current.offset - current.limit) }))}
              onNext={() => setFilters((current) => ({ ...current, offset: current.offset + current.limit }))}
            />
            <Button
              size="sm"
              icon={UserPlus}
              onClick={() => {
                setCreateError(null)
                setCreateForm(emptyCreateForm())
                setCreateModalOpen(true)
              }}
            >
              Create User
            </Button>
          </div>
        </div>
      </Panel>

      <Panel tone="slate" className="flex min-h-0 flex-1 flex-col">
        {users.length ? (
          <div className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-white/10 bg-white/5">
            <div className="sticky top-0 z-10 hidden grid-cols-[minmax(0,1.6fr)_180px_170px] items-center gap-4 border-b border-white/5 bg-[#1a1a1a]/95 px-5 py-3 text-[11px] font-bold uppercase tracking-[0.2em] text-gray-400 backdrop-blur lg:grid">
              <p>User / Permissions</p>
              <p>Telegram / API</p>
              <p className="text-right">Created</p>
            </div>

            <div className="grid gap-0">
              {users.map((user) => {
                const isActive = selectedUserId === user.id

                return (
                  <button
                    key={user.id}
                    type="button"
                    onClick={() => setSelectedUserId(user.id)}
                    className={cn(
                      'grid w-full gap-4 border-b border-white/5 px-4 py-4 text-left transition-all duration-300 last:border-none sm:px-5',
                      'lg:grid-cols-[minmax(0,1.6fr)_180px_170px] lg:items-center',
                      isActive
                        ? 'bg-[#38bdf8]/10 shadow-[0_0_20px_rgba(56,189,248,0.2)]'
                        : 'bg-transparent hover:bg-white/5',
                    )}
                  >
                    <div className="min-w-0 space-y-1.5">
                      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                        <p className="font-semibold text-white">@{user.username}</p>
                        <p className="truncate text-sm text-gray-400">{user.displayName || 'No display name'}</p>
                      </div>
                      <div className="flex flex-wrap items-center gap-2">
                        {user.isAdmin ? <Badge tone="accent">Admin</Badge> : null}
                        <Badge tone="neutral">{user.permissionCount} permissions</Badge>
                        <Badge tone={user.hasApiKey ? 'accent' : 'neutral'}>{user.hasApiKey ? 'API key' : 'No API key'}</Badge>
                      </div>
                    </div>

                    <div className="grid gap-1.5 text-sm">
                      <div className="flex min-w-0 items-center gap-2">
                        <UserRound className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                        <span className="shrink-0 text-[11px] font-bold uppercase tracking-[0.14em] text-gray-400">TG</span>
                        <span className="truncate font-medium text-white">{user.telegramId || 'Not set'}</span>
                      </div>
                      <div className="flex min-w-0 items-center gap-2">
                        <KeyRound className="h-3.5 w-3.5 shrink-0 text-gray-400" />
                        <span className="truncate text-xs font-medium text-gray-400">Last seen {formatDateTime(user.lastSeenAt)}</span>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-2 text-sm text-gray-400 lg:justify-end">
                      <p className="font-medium">{formatDateTime(user.createdAt)}</p>
                    </div>
                  </button>
                )
              })}
            </div>
          </div>
        ) : (
          <div className="min-h-0 flex-1 overflow-y-auto">
            <EmptyState
              title="No users to display"
              description="Create a user or adjust the search."
            />
          </div>
        )}
      </Panel>

      <UserCreateModal
        open={createModalOpen}
        form={createForm}
        saving={creatingUser}
        error={createError}
        onChange={setCreateForm}
        onSubmit={handleCreate}
        onClose={() => {
          setCreateModalOpen(false)
          setCreateError(null)
        }}
      />

      <UserDetailModal
        open={Boolean(selectedUserId)}
        user={selectedUser}
        form={editForm}
        saving={savingUser}
        loading={loadingDetail}
        error={editError}
        onChange={setEditForm}
        onSubmit={handleUpdate}
        onClose={handleCloseDetail}
      />
    </div>
  )
}
