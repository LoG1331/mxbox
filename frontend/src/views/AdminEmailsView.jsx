import { useDeferredValue, useEffect, useMemo, useState } from 'react'
import { RefreshCcw, Search, Trash2 } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { deleteEmailsByIds, deleteEmailById, getEmailById, listSystemEmails } from '../lib/api.js'
import { cn, formatApiError } from '../lib/format.js'
import { EmailDetailModal, EmailFeedList } from '../components/EmailFeed.jsx'
import { Badge, Button, CursorPagination, Input, Panel, Select } from '../components/ui.jsx'
import { useAutoRefresh } from '../hooks/useAutoRefresh.js'
import { useCursorPager } from '../hooks/useCursorPager.js'

const DEFAULT_FILTERS = {
  domain: '',
  address: '',
  search: '',
  limit: 50,
}

const COMPACT_INPUT_CLASS = 'h-10 w-full rounded-xl border-white/10 bg-white/5 px-3.5 py-2 text-sm text-white transition-all duration-300'

function buildVisibleDomainOptions(emails) {
  const counts = new Map()

  emails.forEach((email) => {
    const domain = String(email?.domain || '').trim().toLowerCase()
    if (!domain) {
      return
    }

    counts.set(domain, (counts.get(domain) || 0) + 1)
  })

  return Array.from(counts.entries())
    .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
    .slice(0, 6)
    .map(([domain, count]) => ({ domain, count }))
}

export default function AdminEmailsView({ token }) {
  const [filters, setFilters] = useState(DEFAULT_FILTERS)
  const [listing, setListing] = useState({
    loading: false,
    emails: [],
    count: 0,
    hasMore: false,
  })
  const [selectedEmailId, setSelectedEmailId] = useState(null)
  const [selectedEmail, setSelectedEmail] = useState(null)
  const [includeRawMime, setIncludeRawMime] = useState(false)
  const [loadingDetail, setLoadingDetail] = useState(false)
  const [deletingEmail, setDeletingEmail] = useState(false)
  const [selectedEmailIds, setSelectedEmailIds] = useState([])
  const [deletingSelectedEmails, setDeletingSelectedEmails] = useState(false)
  const deferredAddress = useDeferredValue(filters.address)
  const deferredDomain = useDeferredValue(filters.domain)
  const deferredSearch = useDeferredValue(filters.search)
  const visibleDomainOptions = useMemo(() => buildVisibleDomainOptions(listing.emails), [listing.emails])
  const emailPager = useCursorPager()

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

  async function loadList({ showLoading = true, showError = true } = {}) {
    if (showLoading) {
      setListing((current) => ({ ...current, loading: true }))
    }

    try {
      const response = await listSystemEmails(token, {
        address: deferredAddress,
        domain: deferredDomain,
        search: deferredSearch,
        limit: filters.limit,
        cursor: emailPager.cursor,
      })
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
    void loadList()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [deferredAddress, deferredDomain, deferredSearch, emailPager.cursor, filters.limit, token])

  const refreshNow = useAutoRefresh(async () => {
    await loadList({
      showLoading: false,
      showError: false,
    })
  }, 10000)

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
        toast.error(deletedCount ? 'Some emails were no longer available.' : 'Could not delete the selected emails.')
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
    } catch (error) {
      toast.error(formatApiError(error))
    } finally {
      setDeletingSelectedEmails(false)
    }
  }

  function handleCloseEmailModal() {
    setSelectedEmailId(null)
    setSelectedEmail(null)
  }

  function setDomainFilter(domain) {
    setFilters((current) => ({
      ...current,
      domain,
    }))
    emailPager.reset()
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

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <Panel tone="ember" className="shrink-0 p-3 sm:p-3.5">
        <div className="toolbar">
          <button
            type="button"
            onClick={refreshNow}
            aria-label="Refresh"
            className="pill w-10 shrink-0 justify-center border-[#38bdf8]/20 bg-[#38bdf8]/10 text-[#38bdf8] transition-all duration-300 hover:bg-[#38bdf8]/20"
          >
            <RefreshCcw className={cn('h-4 w-4', listing.loading && 'animate-spin')} />
          </button>

          <label className="min-w-[160px] flex-1">
            <span className="sr-only">Recipient</span>
            <div className="flex h-10 w-full items-center gap-2 rounded-xl border border-white/10 bg-white/5 px-3.5 transition-all duration-300 focus-within:border-[#38bdf8] focus-within:shadow-[0_0_0_1px_#38bdf8]">
              <Search className="h-4 w-4 shrink-0 text-gray-400" />
              <Input
                className="h-10 min-h-0 w-full flex-1 border-0 bg-transparent px-0 py-0 text-sm shadow-none outline-none"
                value={filters.address}
                onChange={(event) => {
                  emailPager.reset()
                  setFilters((current) => ({ ...current, address: event.target.value }))
                }}
                placeholder="Recipient"
              />
            </div>
          </label>

          <label className="min-w-[160px] flex-1">
            <span className="sr-only">Search term</span>
            <Input
              className={COMPACT_INPUT_CLASS}
              value={filters.search}
              onChange={(event) => {
                emailPager.reset()
                setFilters((current) => ({ ...current, search: event.target.value }))
              }}
              placeholder="Search subject, body, headers"
            />
          </label>

          <label className="w-full min-w-[160px] sm:w-[220px]">
            <span className="sr-only">Domain</span>
            <Select
              className="h-10 w-full"
              value={filters.domain}
              onChange={(event) => setDomainFilter(event.target.value)}
            >
              <option value="">All domains</option>
              {visibleDomainOptions.map((item) => (
                <option key={item.domain} value={item.domain}>
                  {`${item.domain} (${item.count})`}
                </option>
              ))}
            </Select>
          </label>

          <div className="ml-auto flex flex-wrap items-center gap-2 sm:justify-end">
            <CursorPagination
              page={emailPager.page}
              hasPrev={emailPager.hasPrev}
              hasNext={listing.hasMore}
              onPrev={emailPager.goPrev}
              onNext={emailPager.goNext}
            />
          </div>
        </div>
      </Panel>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <EmailFeedList
        title="System Mail"
        total={listing.count || listing.emails.length}
        emails={listing.emails}
        selectedEmailId={selectedEmailId}
        selectedEmailIds={selectedEmailIds}
        selectable
        loading={listing.loading}
        onOpenEmail={setSelectedEmailId}
        onToggleEmailSelection={handleToggleEmailSelection}
        onTogglePageSelection={handleTogglePageSelection}
        emptyTitle="No system mail"
        emptyDescription="Try clearing the filters."
        action={(
          <div className="flex flex-wrap items-center justify-end gap-2">
            {selectedEmailIds.length ? <Badge tone="success">{selectedEmailIds.length} selected</Badge> : null}
            <Badge tone="accent">{listing.emails.length} mail</Badge>
            <Button type="button" size="sm" variant="ghost" onClick={() => handleTogglePageSelection(true)} disabled={!listing.emails.length || allVisibleSelected}>
              Select all
            </Button>
            <Button type="button" size="sm" variant="ghost" onClick={() => handleTogglePageSelection(false)} disabled={!selectedEmailIds.length}>
              Clear
            </Button>
            <Button type="button" size="sm" variant="danger" icon={Trash2} loading={deletingSelectedEmails} onClick={handleDeleteSelectedEmails} disabled={!selectedEmailIds.length}>
              Delete
            </Button>
          </div>
        )}
        />

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
    </div>
  )
}
