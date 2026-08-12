import { useDeferredValue, useEffect, useState } from 'react'
import { Plus, Search, Shuffle, Trash2 } from 'lucide-react'
import { toast } from 'react-hot-toast'
import {
  createEmailRegister,
  createRandomEmailRegister,
  deleteEmailsByIds,
  deleteEmailById,
  deleteEmailRegister,
  getEmailById,
  listEmailRegisters,
  listRegisteredEmails,
} from '../lib/api.js'
import { cn, formatApiError } from '../lib/format.js'
import { clampOffset } from '../lib/pagination.js'
import { EmailDetailModal, EmailFeedList } from '../components/EmailFeed.jsx'
import { AutoRefreshButton, Badge, Button, CompactPagination, CursorPagination, Input, Panel } from '../components/ui.jsx'
import { useAutoRefresh } from '../hooks/useAutoRefresh.js'
import { useCursorPager } from '../hooks/useCursorPager.js'

const DEFAULT_FILTERS = {
  address: '',
  search: '',
  limit: 50,
}

export default function EmailsView({ token }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [registrationFilters, setRegistrationFilters] = useState({
    limit: 50,
    offset: 0,
  })
  const [mailboxSearch, setMailboxSearch] = useState('')
  const [debouncedMailboxSearch, setDebouncedMailboxSearch] = useState('')
  const [listing, setListing] = useState({
    loading: false,
    emails: [],
    count: 0,
    hasMore: false,
  })
  const [registrations, setRegistrations] = useState([])
  const [totalRegistrations, setTotalRegistrations] = useState(0)
  const [loadingRegistrations, setLoadingRegistrations] = useState(false)
  const [registrationForm, setRegistrationForm] = useState({
    emailAddress: '',
  })
  const [registeringEmail, setRegisteringEmail] = useState(false)
  const [generatingEmail, setGeneratingEmail] = useState(false)
  const [deletingRegistrationId, setDeletingRegistrationId] = useState(null)
  const [selectedEmailId, setSelectedEmailId] = useState(null)
  const [selectedEmail, setSelectedEmail] = useState(null)
  const [includeRawMime, setIncludeRawMime] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [deletingEmail, setDeletingEmail] = useState(false)
  const [selectedEmailIds, setSelectedEmailIds] = useState([])
  const [deletingSelectedEmails, setDeletingSelectedEmails] = useState(false)
  const deferredSearch = useDeferredValue(filters.search)
  const emailPager = useCursorPager()

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      setDebouncedMailboxSearch(mailboxSearch.trim())
      setRegistrationFilters((current) => (current.offset ? { ...current, offset: 0 } : current))
    }, 300)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [mailboxSearch])

  useEffect(() => {
    if (!selectedEmailId) {
      setSelectedEmail(null)
      return undefined
    }

    let cancelled = false

    async function loadDetail() {
      setLoadingDetail(true)

      try {
        const response = await getEmailById(token, selectedEmailId, { includeRawMime })
        if (!cancelled) {
          setSelectedEmail(response.email)
        }
      } catch (error) {
        if (!cancelled) {
          toast.error(formatApiError(error))
          setSelectedEmail(null)
          setSelectedEmailId(null)
        }
      } finally {
        if (!cancelled) {
          setLoadingDetail(false)
        }
      }
    }

    void loadDetail()

    return () => {
      cancelled = true
    }
  }, [includeRawMime, selectedEmailId, token])

  useEffect(() => {
    if (selectedEmailId && !listing.emails.some((email) => email.id === selectedEmailId)) {
      setSelectedEmailId(null)
      setSelectedEmail(null)
    }
  }, [listing.emails, selectedEmailId])

  async function loadRegistrations({ showError = true } = {}) {
    setLoadingRegistrations(true)

    try {
      const response = await listEmailRegisters(token, {
        limit: registrationFilters.limit,
        offset: registrationFilters.offset,
        search: debouncedMailboxSearch,
      })
      setRegistrations(response.registrations)
      setTotalRegistrations(response.total)

      if (!response.registrations.length && registrationFilters.offset > 0 && response.total <= registrationFilters.offset) {
        setRegistrationFilters((current) => ({
          ...current,
          offset: clampOffset(current.offset, response.total, current.limit),
        }))
      }

      return response
    } catch (error) {
      if (showError) {
        toast.error(formatApiError(error))
      }

      return null
    } finally {
      setLoadingRegistrations(false)
    }
  }

  async function loadList({ showLoading = true, showError = true } = {}) {
    if (showLoading) {
      setListing((current) => ({ ...current, loading: true }))
    }

    try {
      const listParams = {
        address: filters.address,
        search: deferredSearch,
        limit: filters.limit,
        cursor: emailPager.cursor,
      }
      const response = await listRegisteredEmails(token, listParams)
      emailPager.sync(response)
      setSelectedEmailIds((current) => current.filter((id) => response.emails.some((email) => email.id === id)))
      setListing({
        loading: false,
        emails: response.emails,
        count: response.count,
        hasMore: response.hasMore,
      })
      return response
    } catch (error) {
      setListing((current) => ({ ...current, loading: false }))

      if (showError) {
        toast.error(formatApiError(error))
      }

      return null
    }
  }

  useEffect(() => {
    void loadRegistrations()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [registrationFilters.limit, registrationFilters.offset, debouncedMailboxSearch, token])

  useEffect(() => {
    if (!registrations.length) {
      setSelectedEmailIds([])
      setListing({
        loading: false,
        emails: [],
        count: 0,
        hasMore: false,
      })
      return
    }

    void loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredSearch, emailPager.cursor, filters.address, filters.limit, registrations.length, token])

  const refreshNow = useAutoRefresh(async () => {
    if (!registrations.length) {
      return
    }

    await loadList({
      showLoading: false,
      showError: false,
    })
  }, 10000, registrations.length > 0)

  function focusMailbox(emailAddress) {
    setFilters((current) => ({
      ...current,
      address: emailAddress,
    }))
    emailPager.reset()
  }

  async function handleCreateRegistration(event) {
    event.preventDefault()
    setRegisteringEmail(true)

    try {
      const response = await createEmailRegister(token, registrationForm)
      setRegistrationForm({ emailAddress: '' })
      setRegistrationFilters((current) => ({ ...current, offset: 0 }))
      focusMailbox(response.registration.emailAddress)
      toast.success('Mailbox registered')
      await loadRegistrations({ showError: false })
      await loadList({
        showLoading: false,
        showError: false,
      })
    } catch (error) {
      toast.error(formatApiError(error))
    } finally {
      setRegisteringEmail(false)
    }
  }

  async function handleCreateRandomRegistration() {
    setGeneratingEmail(true)

    try {
      const response = await createRandomEmailRegister(token)
      setRegistrationFilters((current) => ({ ...current, offset: 0 }))
      focusMailbox(response.registration.emailAddress)
      toast.success(`Mailbox created: ${response.registration.emailAddress}`)
      await loadRegistrations({ showError: false })
      await loadList({
        showLoading: false,
        showError: false,
      })
    } catch (error) {
      toast.error(formatApiError(error))
    } finally {
      setGeneratingEmail(false)
    }
  }

  async function handleDeleteRegistration(registration) {
    setDeletingRegistrationId(registration.id)

    try {
      await deleteEmailRegister(token, registration.id)
      toast.success('Mailbox removed')

      if (filters.address === registration.emailAddress) {
        setFilters((current) => ({ ...current, address: '' }))
        emailPager.reset()
      }

      if (selectedEmail?.to === registration.emailAddress) {
        setSelectedEmail(null)
        setSelectedEmailId(null)
      }

      await loadRegistrations({ showError: false })
      await loadList({
        showLoading: false,
        showError: false,
      })
    } catch (error) {
      toast.error(formatApiError(error))
    } finally {
      setDeletingRegistrationId(null)
    }
  }

  async function handleDeleteEmail() {
    if (!selectedEmailId) {
      return
    }

    setDeletingEmail(true)

    try {
      await deleteEmailById(token, selectedEmailId)
      toast.success('Email deleted')
      setSelectedEmailIds((current) => current.filter((id) => id !== selectedEmailId))
      setSelectedEmail(null)
      setSelectedEmailId(null)
      const response = await loadList({
        showLoading: false,
        showError: false,
      })
      if (!response?.count && emailPager.hasPrev) {
        emailPager.goPrev()
      }
      await loadRegistrations({ showError: false })
    } catch (error) {
      toast.error(formatApiError(error))
    } finally {
      setDeletingEmail(false)
    }
  }

  async function handleDeleteSelectedEmails() {
    if (!selectedEmailIds.length) {
      return
    }

    setDeletingSelectedEmails(true)

    try {
      const response = await deleteEmailsByIds(token, selectedEmailIds)
      const deletedIds = Array.isArray(response.deletedIds) ? response.deletedIds : []
      const deletedCount = Number(response.deleted || deletedIds.length || 0)

      if (deletedCount > 0) {
        toast.success(`Deleted ${deletedCount} emails`)
      }

      if (response.missingIds?.length || response.deniedIds?.length) {
        toast.error(deletedCount ? 'Some emails are no longer available.' : 'Could not delete selected emails.')
      }

      if (selectedEmailId && deletedIds.includes(selectedEmailId)) {
        setSelectedEmail(null)
        setSelectedEmailId(null)
      }

      setSelectedEmailIds([])
      const listResponse = await loadList({
        showLoading: false,
        showError: false,
      })
      if (!listResponse?.count && emailPager.hasPrev) {
        emailPager.goPrev()
      }
      await loadRegistrations({ showError: false })
    } catch (error) {
      toast.error(formatApiError(error))
    } finally {
      setDeletingSelectedEmails(false)
    }
  }

  function handleToggleEmailSelection(emailId, checked) {
    setSelectedEmailIds((current) => {
      if (!checked) {
        return current.filter((id) => id !== emailId)
      }

      if (current.includes(emailId)) {
        return current
      }

      return [...current, emailId]
    })
  }

  function handleTogglePageSelection(checked) {
    if (!checked) {
      setSelectedEmailIds([])
      return
    }

    setSelectedEmailIds(listing.emails.map((email) => email.id))
  }

  const allVisibleSelected = listing.emails.length > 0 && listing.emails.every((email) => selectedEmailIds.includes(email.id))

  function handleCloseEmailModal() {
    setSelectedEmailId(null)
    setSelectedEmail(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <Panel tone="ocean" className="shrink-0 p-3 sm:p-3.5">
        <div className="space-y-3">
          <div className="toolbar border-b border-white/5 pb-2.5">
            <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#38bdf8]">Registered Mailboxes</p>
            <AutoRefreshButton onClick={refreshNow} />
            {filters.address ? <Badge tone="accent">{filters.address}</Badge> : null}
            {listing.loading || loadingRegistrations ? <Badge tone="warning">Syncing…</Badge> : null}
            <CompactPagination
              className="ml-auto"
              total={totalRegistrations}
              count={registrations.length}
              offset={registrationFilters.offset}
              limit={registrationFilters.limit}
              onLimitChange={(limit) => setRegistrationFilters((current) => ({ ...current, limit, offset: 0 }))}
              onPrev={() => setRegistrationFilters((current) => ({ ...current, offset: Math.max(0, current.offset - current.limit) }))}
              onNext={() => setRegistrationFilters((current) => ({ ...current, offset: current.offset + current.limit }))}
            />
          </div>

          <div className="rounded-xl border border-white/10 bg-white/5 p-2.5 sm:p-3">
            <div className="flex flex-wrap items-stretch gap-2">
              <form className="toolbar min-w-[260px] flex-1" onSubmit={handleCreateRegistration}>
                <Input
                  className="min-w-[200px] flex-1"
                  value={registrationForm.emailAddress}
                  onChange={(event) => setRegistrationForm({ emailAddress: event.target.value })}
                  placeholder="alice@example.com"
                />
                <Button type="submit" icon={Plus} loading={registeringEmail}>
                  Register
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  icon={Shuffle}
                  loading={generatingEmail}
                  onClick={handleCreateRandomRegistration}
                >
                  Random
                </Button>
              </form>

              <div className="toolbar min-w-[240px] flex-1 xl:justify-end">
                <label className="min-w-[220px] grow sm:max-w-[18rem]">
                  <span className="sr-only">Search mailboxes</span>
                  <div className="flex min-h-[40px] items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 transition-all duration-300 focus-within:border-[#38bdf8]">
                    <Search className="h-4 w-4 shrink-0 text-gray-400" />
                    <Input
                      className="min-h-0 flex-1 border-0 bg-transparent px-0 py-0 text-sm shadow-none outline-none"
                      value={mailboxSearch}
                      onChange={(event) => setMailboxSearch(event.target.value)}
                      placeholder="Search mailboxes..."
                    />
                  </div>
                </label>
                <button
                  type="button"
                  onClick={() => focusMailbox('')}
                  className={cn(
                    'inline-flex h-10 items-center gap-2 rounded-xl border px-3 text-sm transition-all duration-300',
                    !filters.address
                      ? 'border-[#38bdf8]/20 bg-[#38bdf8]/10 text-[#38bdf8]'
                      : 'border-white/10 bg-white/5 text-gray-400 hover:bg-white/10 hover:text-white',
                  )}
                >
                  All Mailboxes
                  <span
                    className={cn(
                      'inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1.5 text-[11px] font-bold leading-none',
                      !filters.address ? 'bg-[#38bdf8]/20 text-[#38bdf8]' : 'bg-white/10 text-gray-400',
                    )}
                  >
                    {totalRegistrations}
                  </span>
                </button>
              </div>
            </div>

            {registrations.length ? (
              <div className="mt-3 max-h-80 overflow-y-auto rounded-xl border border-white/10 bg-white/[0.02]">
                {registrations.map((registration) => {
                  const isActive = filters.address === registration.emailAddress

                  return (
                    <div
                      key={registration.id}
                      className={cn(
                        'flex items-center gap-2 border-b border-white/5 px-3 py-2 transition-all duration-300 last:border-none',
                        isActive ? 'bg-[#38bdf8]/10' : 'hover:bg-white/5',
                      )}
                    >
                      <button
                        type="button"
                        className="flex min-w-0 flex-1 items-center gap-2 text-left"
                        onClick={() => focusMailbox(registration.emailAddress)}
                      >
                        <span className={cn('truncate text-sm font-semibold', isActive ? 'text-[#38bdf8]' : 'text-white')}>
                          {registration.emailAddress}
                        </span>
                        <Badge tone={isActive ? 'accent' : 'neutral'}>{registration.domain}</Badge>
                      </button>
                      <span className="shrink-0 text-xs text-gray-400">{registration.emailCount} email</span>
                      <Button
                        type="button"
                        variant="ghost"
                        size="sm"
                        icon={Trash2}
                        className="shrink-0"
                        loading={deletingRegistrationId === registration.id}
                        onClick={() => handleDeleteRegistration(registration)}
                        title="Remove mailbox"
                        aria-label={`Remove ${registration.emailAddress}`}
                      >
                        Remove
                      </Button>
                    </div>
                  )
                })}
              </div>
            ) : (
              <div className="mt-3 rounded-xl border border-dashed border-white/10 bg-white/[0.02] px-3.5 py-2.5 text-sm text-gray-400">
                {debouncedMailboxSearch
                  ? `No mailboxes match "${debouncedMailboxSearch}".`
                  : 'No registered mailboxes yet.'}
              </div>
            )}
          </div>
        </div>
      </Panel>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <EmailFeedList
        title="Registered Mail"
        total={listing.count || listing.emails.length}
        emails={listing.emails}
        selectedEmailId={selectedEmailId}
        selectedEmailIds={selectedEmailIds}
        selectable
        loading={listing.loading}
        onOpenEmail={setSelectedEmailId}
        onToggleEmailSelection={handleToggleEmailSelection}
        onTogglePageSelection={handleTogglePageSelection}
        emptyTitle="No mail to display"
        emptyDescription="Register a mailbox first."
        action={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            <label className="min-w-[220px] grow sm:max-w-[18rem]">
              <span className="sr-only">Search emails</span>
              <div className="flex min-h-[40px] items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 transition-all duration-300 focus-within:border-[#38bdf8]">
                <Search className="h-4 w-4 shrink-0 text-gray-400" />
                <Input
                  className="min-h-0 flex-1 border-0 bg-transparent px-0 py-0 text-sm shadow-none outline-none"
                  value={filters.search}
                  onChange={(event) => {
                    emailPager.reset()
                    setFilters((current) => ({ ...current, search: event.target.value }))
                  }}
                  placeholder="Search subject, body, headers..."
                />
              </div>
            </label>
            {selectedEmailIds.length ? <Badge tone="success">{selectedEmailIds.length} selected</Badge> : null}
            <Button type="button" size="sm" variant="ghost" onClick={() => handleTogglePageSelection(true)} disabled={!listing.emails.length || allVisibleSelected}>
              Select all
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => handleTogglePageSelection(false)} disabled={!selectedEmailIds.length}>
              Deselect
            </Button>
            <Button type="button" size="sm" variant="danger" icon={Trash2} loading={deletingSelectedEmails} onClick={handleDeleteSelectedEmails} disabled={!selectedEmailIds.length}>
              Delete Selected
            </Button>
            <CursorPagination
              page={emailPager.page}
              hasPrev={emailPager.hasPrev}
              hasNext={listing.hasMore}
              onPrev={emailPager.goPrev}
              onNext={emailPager.goNext}
            />
          </div>
        )}
      />
      </div>

      <EmailDetailModal
        key={selectedEmailId || 'email-detail-modal'}
        open={Boolean(selectedEmailId)}
        email={selectedEmail}
        loadingDetail={loadingDetail}
        includeRawMime={includeRawMime}
        onToggleRawMime={setIncludeRawMime}
        deletingEmail={deletingEmail}
        onDeleteEmail={handleDeleteEmail}
        onClose={handleCloseEmailModal}
      />
    </div>
  )
}
