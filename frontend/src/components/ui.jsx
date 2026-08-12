import { Children, isValidElement, useEffect, useId, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { AlertTriangle, Check, ChevronDown, ChevronLeft, ChevronRight, LoaderCircle, X } from 'lucide-react'
import { cn, getApiErrorIssues } from '../lib/format.js'
import { buildPaginationMeta } from '../lib/pagination.js'

const PANEL_TONE_CLASS = {
  neutral: 'panel-tone-neutral',
  ocean: 'panel-tone-ocean',
  sage: 'panel-tone-sage',
  sand: 'panel-tone-sand',
  ember: 'panel-tone-ember',
  slate: 'panel-tone-slate',
}

const SECTION_TONE_CLASS = {
  neutral: 'section-tone-neutral',
  ocean: 'section-tone-ocean',
  sage: 'section-tone-sage',
  sand: 'section-tone-sand',
  ember: 'section-tone-ember',
  slate: 'section-tone-slate',
}

export function Button({
  variant = 'primary',
  size = 'md',
  className,
  loading = false,
  icon: Icon,
  children,
  ...props
}) {
  const variantClass = {
    primary: 'btn btn-primary',
    secondary: 'btn btn-secondary',
    ghost: 'btn btn-ghost',
    danger: 'btn btn-danger',
  }[variant]

  const sizeClass = {
    sm: 'px-3.5 py-2 text-sm',
    md: 'px-4.5 py-3 text-sm',
    lg: 'px-5 py-3.5 text-base',
  }[size]

  return (
    <button
      className={cn(variantClass, sizeClass, className)}
      disabled={loading || props.disabled}
      {...props}
    >
      {loading ? <LoaderCircle className="h-4 w-4 animate-spin" /> : Icon ? <Icon className="h-4 w-4" /> : null}
      <span>{children}</span>
    </button>
  )
}

export function Field({ label, hint, error, className, children }) {
  return (
    <label className={cn('flex flex-col gap-1.5', className)}>
      <div className="flex items-center justify-between gap-3">
        <span className="ml-1 text-xs font-bold uppercase tracking-wide text-gray-400">{label}</span>
        {hint && !error ? <span className="text-[11px] text-gray-500">{hint}</span> : null}
      </div>
      {children}
      {error ? <span className="ml-1 text-xs font-semibold text-red-400">{error}</span> : null}
    </label>
  )
}

/**
 * Shows API errors right inside the form instead of only flashing a toast.
 * Issues already mapped to a specific field are rendered inline by `Field`,
 * here we only summarize the remaining ones.
 */
export function FormError({ error, handledFields = [], className }) {
  if (!error) {
    return null
  }

  const handled = new Set(handledFields)
  const issues = getApiErrorIssues(error).filter((issue) => !issue.field || !handled.has(issue.field))

  return (
    <div
      role="alert"
      className={cn(
        'flex gap-3 rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3',
        className,
      )}
    >
      <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-red-400" />
      <div className="min-w-0 space-y-1">
        <p className="text-sm font-semibold text-red-400">{error.message || 'Action failed'}</p>
        {issues.length ? (
          <ul className="space-y-0.5 text-[12px] leading-5 text-red-400">
            {issues.map((issue, index) => (
              <li key={`${issue.field}-${index}`}>
                {issue.label ? `${issue.label}: ` : ''}{issue.message}
              </li>
            ))}
          </ul>
        ) : null}
        {error.requestId ? (
          <p className="text-[11px] text-red-400/75">Error code: {error.requestId}</p>
        ) : null}
      </div>
    </div>
  )
}

export function Input({ className, invalid = false, ...props }) {
  return (
    <input
      className={cn('form-input', invalid && 'border-red-500 focus:border-red-500 focus:shadow-[0_0_0_1px_#ef4444]', className)}
      aria-invalid={invalid || undefined}
      {...props}
    />
  )
}

export function TextArea({ className, rows = 4, ...props }) {
  return <textarea rows={rows} className={cn('form-input resize-y', className)} {...props} />
}

export function Select({ className, children, invalid = false, value, onChange, disabled = false, name, ...props }) {
  const [open, setOpen] = useState(false)
  const containerRef = useRef(null)
  const triggerRef = useRef(null)
  const dropdownRef = useRef(null)
  const listboxId = useId()

  const options = []
  Children.forEach(children, (child) => {
    if (isValidElement(child) && child.type === 'option') {
      options.push({
        value: child.props.value ?? child.props.children,
        label: child.props.children,
      })
    }
  })
  const selected = options.find((option) => String(option.value) === String(value))

  function handleSelect(optionValue) {
    setOpen(false)
    onChange?.({ target: { value: String(optionValue), name } })
  }

  // Close on outside interaction / viewport changes (scroll listener uses capture
  // to catch scrolls inside modal containers too).
  useEffect(() => {
    if (!open) {
      return undefined
    }

    function handlePointerDown(event) {
      if (!containerRef.current?.contains(event.target) && !dropdownRef.current?.contains(event.target)) {
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
      if (event?.target && dropdownRef.current?.contains(event.target)) {
        return
      }
      setOpen(false)
    }

    document.addEventListener('mousedown', handlePointerDown)
    document.addEventListener('keydown', handleKeyDown, true)
    window.addEventListener('scroll', handleViewportChange, true)
    window.addEventListener('resize', handleViewportChange)

    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      document.removeEventListener('keydown', handleKeyDown, true)
      window.removeEventListener('scroll', handleViewportChange, true)
      window.removeEventListener('resize', handleViewportChange)
    }
  }, [open])

  // Position the portaled dropdown from the trigger rect, flip up when needed.
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
    const flipUp = spaceBelow < 180 && spaceAbove > spaceBelow
    const available = Math.max(140, Math.min(320, (flipUp ? spaceAbove : spaceBelow) - 8))

    dropdown.style.left = `${rect.left}px`
    dropdown.style.width = `${rect.width}px`
    dropdown.style.maxHeight = `${available}px`
    if (flipUp) {
      dropdown.style.top = 'auto'
      dropdown.style.bottom = `${window.innerHeight - rect.top + gap}px`
    } else {
      dropdown.style.bottom = 'auto'
      dropdown.style.top = `${rect.bottom + gap}px`
    }
  }, [open])

  return (
    <div className="relative" ref={containerRef}>
      <button
        ref={triggerRef}
        type="button"
        disabled={disabled}
        onClick={() => setOpen((current) => !current)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-invalid={invalid || undefined}
        className={cn(
          'form-input flex w-full cursor-pointer appearance-none items-center justify-between gap-2 text-left',
          invalid && 'border-red-500 focus:border-red-500 focus:shadow-[0_0_0_1px_#ef4444]',
          disabled && 'cursor-not-allowed opacity-60',
          className,
        )}
        {...props}
      >
        <span className="min-w-0 flex-1 truncate">{selected ? selected.label : value}</span>
        <ChevronDown className={cn('h-4 w-4 shrink-0 text-gray-400 transition-transform duration-300', open && 'rotate-180')} />
      </button>

      {open
        ? createPortal(
            <div
              ref={dropdownRef}
              id={listboxId}
              role="listbox"
              className="fixed z-[60] flex flex-col overflow-hidden rounded-xl border border-white/10 bg-[#1a1a1a]/95 shadow-2xl backdrop-blur-xl"
            >
              <div className="min-h-0 flex-1 overflow-y-auto">
                {options.map((option) => {
                  const isSelected = String(option.value) === String(value)

                  return (
                    <button
                      key={String(option.value)}
                      type="button"
                      role="option"
                      aria-selected={isSelected}
                      onClick={() => handleSelect(option.value)}
                      className={cn(
                        'flex w-full items-center gap-3 border-b border-white/5 px-4 py-2.5 text-left text-sm transition-all duration-300 last:border-none',
                        isSelected ? 'bg-[#38bdf8]/10 text-[#38bdf8]' : 'text-gray-300 hover:bg-white/5 hover:text-white',
                      )}
                    >
                      <span className="min-w-0 flex-1 truncate">{option.label}</span>
                      {isSelected ? <Check className="h-4 w-4 shrink-0 text-[#38bdf8]" /> : null}
                    </button>
                  )
                })}
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  )
}

export function Checkbox({ label, className, ...props }) {
  return (
    <label className={cn('inline-flex items-center gap-3 text-sm font-medium text-gray-300', className)}>
      <input
        type="checkbox"
        className="checkbox"
        {...props}
      />
      <span>{label}</span>
    </label>
  )
}

export function Panel({
  title,
  eyebrow,
  description,
  action,
  tone = 'neutral',
  className,
  children,
}) {
  return (
    <section className={cn('panel rounded-2xl p-4 sm:p-5', PANEL_TONE_CLASS[tone] || PANEL_TONE_CLASS.neutral, className)}>
      {(title || description || action || eyebrow) ? (
        <header className="mb-4 flex flex-wrap items-center justify-between gap-x-4 gap-y-3">
          <div className="min-w-0 space-y-1.5">
            {eyebrow ? <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#38bdf8]">{eyebrow}</p> : null}
            {title ? <h2 className="text-xl font-bold tracking-tight text-white sm:text-2xl">{title}</h2> : null}
            {description ? <p className="max-w-2xl text-[13px] leading-5 text-gray-400">{description}</p> : null}
          </div>
          {action ? <div className="flex shrink-0 flex-wrap items-center gap-2">{action}</div> : null}
        </header>
      ) : null}
      {children}
    </section>
  )
}

export function SectionHeader({ eyebrow, title, description, action, tone = 'neutral' }) {
  return (
    <section className={cn('section-header-shell', SECTION_TONE_CLASS[tone] || SECTION_TONE_CLASS.neutral)}>
      <div className="flex flex-col gap-3 lg:flex-row lg:flex-wrap lg:items-center lg:justify-between">
        <div className="min-w-0 space-y-1.5">
          {eyebrow ? <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#38bdf8]">{eyebrow}</p> : null}
          <h1 className="text-2xl font-bold tracking-tight text-white sm:text-3xl">{title}</h1>
          {description ? <p className="max-w-3xl text-[13px] leading-5 text-gray-400 sm:text-sm">{description}</p> : null}
        </div>
        {action ? <div className="flex flex-wrap items-center gap-2 lg:justify-end">{action}</div> : null}
      </div>
    </section>
  )
}

export function Badge({ tone = 'neutral', children, className }) {
  const toneClass = {
    neutral: 'border-white/10 bg-white/5 text-gray-400',
    accent: 'border-[#38bdf8]/20 bg-[#38bdf8]/10 text-[#38bdf8]',
    warning: 'border-amber-500/20 bg-amber-500/10 text-amber-400',
    danger: 'border-red-500/20 bg-red-500/10 text-red-400',
    success: 'border-emerald-500/20 bg-emerald-500/10 text-emerald-400',
  }[tone]

  return <span className={cn('pill', toneClass, className)}>{children}</span>
}

export function AutoRefreshButton({ onClick, className, children = 'Refresh' }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'pill border-[#38bdf8]/20 bg-[#38bdf8]/10 text-[#38bdf8] transition-all duration-300 hover:bg-[#38bdf8]/20',
        className,
      )}
    >
      {children}
    </button>
  )
}

const PAGINATION_BUTTON_BASE = 'inline-flex h-9 items-center gap-1 rounded-full border px-3 text-sm font-semibold transition-all duration-300'
const PAGINATION_BUTTON_ENABLED = 'border-white/10 bg-white/5 text-white hover:bg-white/10'
const PAGINATION_BUTTON_DISABLED = 'cursor-not-allowed border-white/5 bg-white/[0.02] text-gray-600'

export function CompactPagination({
  total = 0,
  count = 0,
  offset = 0,
  limit = 50,
  onPrev,
  onNext,
  onLimitChange,
  limitOptions = [25, 50, 100],
  className,
}) {
  const { pageStart, pageEnd, hasPrev, hasNext } = buildPaginationMeta({
    total,
    count,
    offset,
    limit,
  })

  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Badge tone="neutral">
        {pageStart}-{pageEnd} / {total}
      </Badge>
      {onLimitChange ? (
        <label className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 text-sm font-semibold text-white">
          <span className="text-gray-400">Per page</span>
          <select
            value={String(limit)}
            onChange={(event) => onLimitChange(Number(event.target.value))}
            className="h-9 rounded-full bg-transparent pr-1 text-sm outline-none"
          >
            {limitOptions.map((option) => (
              <option key={option} value={option}>
                {option}
              </option>
            ))}
          </select>
        </label>
      ) : (
        <Badge tone="neutral">{limit} per page</Badge>
      )}
      <button
        type="button"
        onClick={onPrev}
        disabled={!hasPrev}
        className={cn(PAGINATION_BUTTON_BASE, hasPrev ? PAGINATION_BUTTON_ENABLED : PAGINATION_BUTTON_DISABLED)}
      >
        <ChevronLeft className="h-4 w-4" />
        <span>Prev</span>
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={!hasNext}
        className={cn(PAGINATION_BUTTON_BASE, hasNext ? PAGINATION_BUTTON_ENABLED : PAGINATION_BUTTON_DISABLED)}
      >
        <span>Next</span>
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}

export function CursorPagination({
  page = 1,
  hasPrev = false,
  hasNext = false,
  onPrev,
  onNext,
  className,
}) {
  return (
    <div className={cn('flex flex-wrap items-center gap-2', className)}>
      <Badge tone="neutral">Page {page}</Badge>
      <button
        type="button"
        onClick={onPrev}
        disabled={!hasPrev}
        className={cn(PAGINATION_BUTTON_BASE, hasPrev ? PAGINATION_BUTTON_ENABLED : PAGINATION_BUTTON_DISABLED)}
      >
        <ChevronLeft className="h-4 w-4" />
        <span>Prev</span>
      </button>
      <button
        type="button"
        onClick={onNext}
        disabled={!hasNext}
        className={cn(PAGINATION_BUTTON_BASE, hasNext ? PAGINATION_BUTTON_ENABLED : PAGINATION_BUTTON_DISABLED)}
      >
        <span>Next</span>
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  )
}

export function MetricCard({ label, value, helper, icon: Icon, tone = 'accent' }) {
  const accentClass = {
    accent: 'bg-[#38bdf8]/10 text-[#38bdf8] border border-[#38bdf8]/20',
    warning: 'bg-amber-500/10 text-amber-400 border border-amber-500/20',
    danger: 'bg-red-500/10 text-red-400 border border-red-500/20',
    neutral: 'bg-white/5 text-gray-300 border border-white/10',
  }[tone]

  return (
    <div className="muted-card rounded-2xl p-3.5 sm:p-4">
      <div className="mb-3 flex items-start justify-between gap-3">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">{label}</p>
        {Icon ? (
          <span className={cn('inline-flex h-8 w-8 items-center justify-center rounded-xl', accentClass)}>
            <Icon className="h-4 w-4" />
          </span>
        ) : null}
      </div>
      <div className="space-y-1">
        <p className="text-2xl font-bold tracking-tight text-white">{value}</p>
        {helper ? <p className="text-[11px] leading-4 text-gray-400">{helper}</p> : null}
      </div>
    </div>
  )
}

export function EmptyState({ title, description, action }) {
  return (
    <div className="panel rounded-2xl border-dashed px-5 py-8 text-center">
      <div className="mx-auto flex max-w-md flex-col items-center gap-3">
        <p className="text-xl font-bold text-white">{title}</p>
        <p className="text-[13px] leading-5 text-gray-400">{description}</p>
        {action ? <div className="pt-2">{action}</div> : null}
      </div>
    </div>
  )
}

export function KeyValueList({ items }) {
  return (
    <dl className="grid gap-3 sm:grid-cols-2">
      {items.map((item) => (
        <div key={item.label} className="rounded-xl border border-white/10 bg-white/5 px-4 py-3">
          <dt className="text-xs font-bold uppercase tracking-[0.16em] text-gray-400">{item.label}</dt>
          <dd className="mt-1 text-sm font-semibold text-white">{item.value}</dd>
        </div>
      ))}
    </dl>
  )
}

export function CodeBlock({ value, className }) {
  return (
    <pre className={cn('overflow-x-auto rounded-xl border border-white/10 bg-black/40 p-4 text-xs leading-6 text-gray-300', className)}>
      {value}
    </pre>
  )
}

export function ModalShell({
  open,
  onClose,
  eyebrow,
  title,
  description,
  action,
  tone = 'neutral',
  size = 'lg',
  children,
}) {
  useEffect(() => {
    if (!open) {
      return undefined
    }

    const previousOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        onClose?.()
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

  const sizeClass = {
    md: 'max-w-2xl',
    lg: 'max-w-4xl',
    xl: 'max-w-5xl',
  }[size] || 'max-w-4xl'

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6" onClick={onClose}>
      <div
        className={cn(
          'panel flex max-h-[92vh] w-full flex-col overflow-hidden rounded-t-2xl border border-white/10 !bg-[#1a1a1a]/95 shadow-2xl sm:rounded-2xl',
          PANEL_TONE_CLASS[tone] || PANEL_TONE_CLASS.neutral,
          sizeClass,
        )}
        onClick={(event) => event.stopPropagation()}
      >
        <div className="flex items-start justify-between gap-3 border-b border-white/5 px-4 py-3 sm:px-5">
          <div className="min-w-0 flex-1">
            {eyebrow ? <p className="text-[11px] font-bold uppercase tracking-[0.28em] text-[#38bdf8]">{eyebrow}</p> : null}
            {(title || action) ? (
              <div className="mt-1 flex flex-wrap items-center gap-2.5">
                {title ? (
                  <h2 className="max-w-3xl text-lg font-bold tracking-tight text-white sm:text-xl">
                    {title}
                  </h2>
                ) : null}
                {action ? <div className="min-w-0">{action}</div> : null}
              </div>
            ) : null}
            {description ? <p className="mt-1.5 max-w-2xl text-[13px] leading-5 text-gray-400">{description}</p> : null}
          </div>
          <div className="shrink-0">
            <button
              type="button"
              className="inline-flex h-10 w-10 items-center justify-center rounded-lg text-gray-400 transition-colors hover:bg-white/5 hover:text-white"
              onClick={onClose}
              aria-label="Close modal"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {/* Body keeps overflow-y-auto so long content still scrolls inside the modal frame.
            Child dropdowns/popovers (e.g. UserPicker) must render via portal to document.body
            so they are not clipped by the shell's overflow + transform/overflow-hidden. */}
        <div className="overflow-y-auto px-4 py-4 sm:px-5 sm:py-5">
          {children}
        </div>
      </div>
    </div>
  )
}
