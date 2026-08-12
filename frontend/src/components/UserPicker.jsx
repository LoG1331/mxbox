import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { Check, ChevronDown, Search, UserRound, X } from 'lucide-react'
import { listUsers } from '../lib/api.js'
import { cn, formatApiError } from '../lib/format.js'
import { Badge, Input } from './ui.jsx'

const PAGE_SIZE = 50

function userLabel(user) {
  if (!user) {
    return ''
  }

  return user.displayName ? `@${user.username} · ${user.displayName}` : `@${user.username}`
}

/**
 * Pick a user from a list instead of typing a userId manually.
 * Search runs server-side, so it is not limited to the users already loaded.
 */
export default function UserPicker({
  token,
  value,
  onChange,
  label = 'User',
  placeholder = 'Select user',
  hint,
  error,
  allowClear = true,
  disabled = false,
  className,
}) {
  const listboxId = useId()
  const containerRef = useRef(null)
  const triggerRef = useRef(null)
  const dropdownRef = useRef(null)
  const searchInputRef = useRef(null)
  const [open, setOpen] = useState(false)
  const [query, setQuery] = useState('')
  const [users, setUsers] = useState([])
  const [total, setTotal] = useState(0)
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState('')
  const [pickedUser, setPickedUser] = useState(null)

  const selectedId = value ? String(value) : ''

  // Keep the just-picked user so the label survives list reloads on new keywords,
  // but still prefer fresh data from the list when available.
  const selectedUser = useMemo(() => {
    if (!selectedId) {
      return null
    }

    const fromList = users.find((user) => String(user.id) === selectedId)
    if (fromList) {
      return fromList
    }

    return pickedUser && String(pickedUser.id) === selectedId ? pickedUser : null
  }, [pickedUser, selectedId, users])

  useEffect(() => {
    if (!open) {
      return undefined
    }

    let cancelled = false
    const timeoutId = window.setTimeout(async () => {
      setLoading(true)

      try {
        const response = await listUsers(token, {
          q: query.trim() || undefined,
          limit: PAGE_SIZE,
          offset: 0,
        })

        if (!cancelled) {
          setUsers(response.users)
          setTotal(response.total)
          setLoadError('')
        }
      } catch (requestError) {
        if (!cancelled) {
          setUsers([])
          setTotal(0)
          setLoadError(formatApiError(requestError))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }, query ? 250 : 0)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutId)
    }
  }, [open, query, token])

  useEffect(() => {
    if (!open) {
      return undefined
    }

    function handlePointerDown(event) {
      const insideTrigger = containerRef.current?.contains(event.target)
      const insideDropdown = dropdownRef.current?.contains(event.target)
      if (!insideTrigger && !insideDropdown) {
        setOpen(false)
      }
    }

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        event.stopPropagation()
        setOpen(false)
      }
    }

    function handleViewportChange(event) {
      // Scrolling inside the dropdown (listbox) must not close it
      if (event?.target && dropdownRef.current?.contains(event.target)) {
        return
      }
      setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown, true)
    // capture=true to also catch scrolls inside nested containers (e.g. modal overflow-y-auto)
    window.addEventListener('scroll', handleViewportChange, true)
    window.addEventListener('resize', handleViewportChange)
    searchInputRef.current?.focus()

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('scroll', handleViewportChange, true)
      window.removeEventListener('resize', handleViewportChange)
    }
  }, [open])

  // Position the dropdown (portaled to body) from the trigger: match its width,
  // flip upward when space below is insufficient, cap max-h to remaining space.
  useLayoutEffect(() => {
    if (!open) {
      return
    }

    const trigger = triggerRef.current
    const dropdown = dropdownRef.current
    if (!trigger || !dropdown) {
      return
    }

    const rect = trigger.getBoundingClientRect()
    const gap = 6
    const spaceBelow = window.innerHeight - rect.bottom - gap
    const spaceAbove = rect.top - gap
    const flipUp = spaceBelow < 200 && spaceAbove > spaceBelow
    const maxHeight = Math.max(140, Math.min(320, (flipUp ? spaceAbove : spaceBelow) - gap))

    dropdown.style.left = `${rect.left}px`
    dropdown.style.width = `${rect.width}px`
    dropdown.style.maxHeight = `${maxHeight}px`
    if (flipUp) {
      dropdown.style.top = 'auto'
      dropdown.style.bottom = `${window.innerHeight - rect.top + gap}px`
    } else {
      dropdown.style.bottom = 'auto'
      dropdown.style.top = `${rect.bottom + gap}px`
    }
  }, [open])

  const buttonText = useMemo(() => {
    if (selectedUser) {
      return userLabel(selectedUser)
    }

    return selectedId ? `User #${selectedId}` : placeholder
  }, [placeholder, selectedId, selectedUser])

  function handleSelect(user) {
    setPickedUser(user)
    onChange?.(String(user.id), user)
    setOpen(false)
  }

  function handleClear(event) {
    event.stopPropagation()
    setPickedUser(null)
    onChange?.('', null)
  }

  return (
    <div className={cn('flex flex-col gap-1.5', className)} ref={containerRef}>
      {label || (hint && !error) ? (
        <div className="flex items-center justify-between gap-3">
          {label ? <span className="ml-1 text-xs font-bold uppercase tracking-wide text-gray-400">{label}</span> : null}
          {hint && !error ? <span className="text-[11px] text-gray-500">{hint}</span> : null}
        </div>
      ) : null}

      <div>
        <button
          ref={triggerRef}
          type="button"
          disabled={disabled}
          onClick={() => setOpen((current) => !current)}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listboxId : undefined}
          aria-invalid={error ? true : undefined}
          className={cn(
            'form-input flex w-full items-center gap-2 text-left',
            error && 'border-red-500',
            disabled && 'cursor-not-allowed opacity-60',
          )}
        >
          <UserRound className="h-4 w-4 shrink-0 text-[#38bdf8]" />
          <span className={cn('min-w-0 flex-1 truncate', !selectedId && 'text-gray-500')}>
            {buttonText}
          </span>
          {selectedId && allowClear && !disabled ? (
            <span
              role="button"
              tabIndex={0}
              aria-label="Clear selection"
              onClick={handleClear}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  handleClear(event)
                }
              }}
              className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-gray-400 transition-colors hover:bg-white/10 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </span>
          ) : null}
          <ChevronDown className={cn('h-4 w-4 shrink-0 text-gray-400 transition-transform duration-300', open && 'rotate-180')} />
        </button>

        {open
          ? createPortal(
              <div
                ref={dropdownRef}
                className="fixed z-[60] flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#1a1a1a]/95 shadow-2xl backdrop-blur-xl"
              >
                <div className="shrink-0 border-b border-white/5 p-2">
                  <div className="relative">
                    <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-500" />
                    <Input
                      ref={searchInputRef}
                      className="min-h-[40px] py-2 pl-9 pr-3 text-sm"
                      value={query}
                      onChange={(event) => setQuery(event.target.value)}
                      placeholder="Search users…"
                    />
                  </div>
                </div>

                <div id={listboxId} role="listbox" className="min-h-0 flex-1 overflow-y-auto">
                  {loading ? (
                    <p className="px-4 py-6 text-center text-sm text-gray-400">Loading…</p>
                  ) : loadError ? (
                    <p className="px-4 py-6 text-center text-sm text-red-400">{loadError}</p>
                  ) : users.length ? (
                    users.map((user) => {
                      const isSelected = String(user.id) === selectedId

                      return (
                        <button
                          key={user.id}
                          type="button"
                          role="option"
                          aria-selected={isSelected}
                          onClick={() => handleSelect(user)}
                          className={cn(
                            'flex w-full items-center gap-3 border-b border-white/5 px-4 py-2.5 text-left transition-all duration-300 last:border-none',
                            isSelected ? 'bg-[#38bdf8]/10' : 'hover:bg-white/5',
                          )}
                        >
                          <div className="min-w-0 flex-1">
                            <div className="flex flex-wrap items-center gap-2">
                              <p className="truncate text-sm font-semibold text-white">@{user.username}</p>
                              {user.isAdmin ? <Badge tone="accent">admin</Badge> : null}
                              {user.status !== 'active' ? <Badge tone="warning">{user.status}</Badge> : null}
                            </div>
                            <p className="truncate text-xs text-gray-400">
                              {user.displayName ? `${user.displayName} · ID ${user.id}` : `ID ${user.id}`}
                            </p>
                          </div>
                          {isSelected ? <Check className="h-4 w-4 shrink-0 text-[#38bdf8]" /> : null}
                        </button>
                      )
                    })
                  ) : (
                    <p className="px-4 py-6 text-center text-sm text-gray-400">
                      {query ? 'No matching users' : 'No users yet'}
                    </p>
                  )}
                </div>

                {!loading && !loadError && total > users.length ? (
                  <p className="shrink-0 border-t border-white/5 px-4 py-2 text-[11px] text-gray-500">
                    Showing {users.length} / {total} — type to search
                  </p>
                ) : null}
              </div>,
              document.body,
            )
          : null}
      </div>

      {error ? <span className="ml-1 text-xs font-semibold text-red-400">{error}</span> : null}
    </div>
  )
}
