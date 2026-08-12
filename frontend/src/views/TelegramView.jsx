import { useEffect, useState } from 'react'
import { Bot, Clock, ListRestart, RefreshCcw, Save, Trash2, Webhook } from 'lucide-react'
import { toast } from 'react-hot-toast'
import { getTelegramSettings, registerTelegramCommands, updateTelegramSettings } from '../lib/api.js'
import { cn, formatApiError, formatDateTime } from '../lib/format.js'
import { AutoRefreshButton, Badge, Button, Checkbox, Field, Input, MetricCard, Panel } from '../components/ui.jsx'
import { useAutoRefresh } from '../hooks/useAutoRefresh.js'

function BotToggleCard({ title, checked, onChange }) {
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

function RuntimeStatusTile({ icon, label, value, active = false, breakAll = false }) {
  return (
    <div className="flex items-center gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 transition-all duration-300 hover:bg-white/10">
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[#38bdf8]/20 bg-[#38bdf8]/10 text-[#38bdf8]">
        {icon}
      </span>
      <div className="min-w-0">
        <p className="text-[10px] font-bold uppercase tracking-[0.16em] text-gray-400">{label}</p>
        <p className="mt-0.5 flex items-center gap-1.5 text-sm font-semibold text-white">
          {active ? <span className="h-2 w-2 shrink-0 animate-pulse rounded-full bg-emerald-400" /> : null}
          <span className={breakAll ? 'min-w-0 break-all' : 'truncate'}>{value}</span>
        </p>
      </div>
    </div>
  )
}

function StatusBadge({ runtime }) {
  if (!runtime?.enabled) {
    return <Badge tone="warning">Bot off</Badge>
  }

  if (runtime.lastError) {
    return <Badge tone="danger">Runtime error</Badge>
  }

  if (runtime.workerActive) {
    return <Badge tone="success">Bot running</Badge>
  }

  return <Badge tone="warning">Bot inactive</Badge>
}

export default function TelegramView({ token }) {
  const [settings, setSettings] = useState(null)
  const [runtime, setRuntime] = useState(null)
  const [loading, setLoading] = useState(false)
  const [saving, setSaving] = useState(false)
  const [registeringCommands, setRegisteringCommands] = useState(false)
  const [form, setForm] = useState({
    enabled: false,
    publicBaseUrl: '',
    botToken: '',
    clearBotToken: false,
  })
  const canRegisterCommands = Boolean(
    form.enabled
      && form.publicBaseUrl.trim()
      && !form.clearBotToken
      && (settings?.botTokenConfigured || form.botToken.trim()),
  )

  async function loadTelegramConfig({ showLoading = true, showError = true } = {}) {
    if (showLoading) {
      setLoading(true)
    }

    try {
      const response = await getTelegramSettings(token)
      setSettings(response.settings)
      setRuntime(response.runtime)
      setForm({
        enabled: Boolean(response.settings?.enabled),
        publicBaseUrl: response.settings?.publicBaseUrl || '',
        botToken: '',
        clearBotToken: false,
      })
      return response
    } catch (error) {
      if (showError) {
        toast.error(formatApiError(error))
      }
      return null
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    let cancelled = false

    async function loadInitialConfig() {
      setLoading(true)

      try {
        const response = await getTelegramSettings(token)
        if (cancelled) {
          return
        }

        setSettings(response.settings)
        setRuntime(response.runtime)
        setForm({
          enabled: Boolean(response.settings?.enabled),
          publicBaseUrl: response.settings?.publicBaseUrl || '',
          botToken: '',
          clearBotToken: false,
        })
      } catch (error) {
        if (!cancelled) {
          toast.error(formatApiError(error))
        }
      } finally {
        if (!cancelled) {
          setLoading(false)
        }
      }
    }

    void loadInitialConfig()

    return () => {
      cancelled = true
    }
  }, [token])

  const refreshNow = useAutoRefresh(async () => {
    await loadTelegramConfig({
      showLoading: false,
      showError: false,
    })
  }, 10000)

  async function handleSubmit(event) {
    event.preventDefault()
    setSaving(true)

    try {
      const response = await updateTelegramSettings(token, {
        enabled: form.enabled,
        publicBaseUrl: form.publicBaseUrl,
        botToken: form.botToken || undefined,
        clearBotToken: form.clearBotToken,
      })
      setSettings(response.settings)
      setRuntime(response.runtime)
      setForm((current) => ({
        ...current,
        botToken: '',
        clearBotToken: false,
      }))
      toast.success('Telegram bot settings updated')
    } catch (error) {
      toast.error(formatApiError(error))
      await loadTelegramConfig({
        showLoading: false,
        showError: false,
      })
    } finally {
      setSaving(false)
    }
  }

  async function handleRegisterCommands() {
    setRegisteringCommands(true)

    try {
      const response = await registerTelegramCommands(token)
      setRuntime(response.runtime)
      toast.success(`Registered ${response.count} Telegram commands`)
    } catch (error) {
      toast.error(formatApiError(error))
      await loadTelegramConfig({
        showLoading: false,
        showError: false,
      })
    } finally {
      setRegisteringCommands(false)
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col gap-4">
      <div className="flex shrink-0 flex-wrap items-center gap-2 text-sm">
        <p className="text-[10px] font-bold uppercase tracking-[0.22em] text-[#38bdf8]">Telegram</p>
        <div className="flex flex-wrap items-center gap-2">
          <AutoRefreshButton onClick={refreshNow} />
          {loading ? <Badge tone="warning">Syncing…</Badge> : null}
          <StatusBadge runtime={runtime} />
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-y-auto">
      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-4">
        <MetricCard
          label="Bot token"
          value={settings?.botTokenConfigured ? 'Saved' : 'Not set'}
          helper={settings?.botTokenMasked || ''}
          icon={Bot}
          tone={settings?.botTokenConfigured ? 'accent' : 'warning'}
        />
        <MetricCard
          label="Webhook"
          value={runtime?.workerActive ? 'Active' : 'Idle'}
          helper={runtime?.lastWebhookRegisteredAt ? formatDateTime(runtime.lastWebhookRegisteredAt) : ''}
          icon={Webhook}
          tone={runtime?.workerActive ? 'accent' : 'warning'}
        />
        <MetricCard
          label="Outbox pending"
          value={String(runtime?.outbox?.pending || 0)}
          icon={RefreshCcw}
          tone={runtime?.outbox?.failed ? 'danger' : 'neutral'}
        />
        <MetricCard
          label="Last error"
          value={runtime?.lastError ? 'Error' : 'OK'}
          helper={runtime?.lastError || ''}
          icon={Save}
          tone={runtime?.lastError ? 'danger' : 'accent'}
        />
      </div>

      <Panel
        title="Bot settings"
        tone="sage"
      >
        <form className="space-y-6" onSubmit={handleSubmit}>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Public base URL">
              <Input
                value={form.publicBaseUrl}
                onChange={(event) => setForm((current) => ({ ...current, publicBaseUrl: event.target.value }))}
                placeholder="https://mail.example.com"
              />
            </Field>
            <Field label="Bot token" hint={settings?.botTokenConfigured ? `Using ${settings.botTokenMasked}` : 'No token saved'}>
              <Input
                type="password"
                value={form.botToken}
                onChange={(event) => setForm((current) => ({ ...current, botToken: event.target.value, clearBotToken: false }))}
                placeholder={settings?.botTokenConfigured ? 'Enter new token to replace' : '123456:ABCDEF...'}
                autoComplete="new-password"
              />
            </Field>
          </div>

          <div className="grid gap-3 sm:grid-cols-2">
            <BotToggleCard
              title="Enable Telegram bot"
              checked={form.enabled}
              onChange={(event) => setForm((current) => ({ ...current, enabled: event.target.checked }))}
            />
            <BotToggleCard
              title="Clear saved token"
              checked={form.clearBotToken}
              onChange={(event) => setForm((current) => ({
                ...current,
                clearBotToken: event.target.checked,
                botToken: event.target.checked ? '' : current.botToken,
              }))}
            />
          </div>

          <div className="grid gap-3 lg:grid-cols-3">
            <RuntimeStatusTile
              icon={<Webhook className="h-4 w-4" />}
              label="Webhook URL"
              value={runtime?.webhookUrl || 'Not registered'}
              active={Boolean(runtime?.workerActive)}
              breakAll
            />
            <RuntimeStatusTile
              icon={<Clock className="h-4 w-4" />}
              label="Last poll"
              value={runtime?.lastPollAt ? formatDateTime(runtime.lastPollAt) : 'Not set'}
            />
            <RuntimeStatusTile
              icon={<RefreshCcw className="h-4 w-4" />}
              label="Last delivery"
              value={runtime?.lastDeliveryAt ? formatDateTime(runtime.lastDeliveryAt) : 'Not set'}
            />
          </div>

          <div className="flex flex-wrap items-center justify-end gap-2 border-t border-white/5 pt-4">
            <Button
              type="button"
              size="sm"
              variant="ghost"
              icon={Trash2}
              onClick={() => setForm((current) => ({ ...current, enabled: false, clearBotToken: true, botToken: '' }))}
            >
              Disable bot
            </Button>
            <Button
              type="button"
              size="sm"
              variant="secondary"
              icon={ListRestart}
              disabled={!canRegisterCommands}
              loading={registeringCommands}
              onClick={handleRegisterCommands}
            >
              Register commands
            </Button>
            <Button type="submit" size="sm" icon={Save} loading={saving}>
              Save
            </Button>
          </div>
        </form>
      </Panel>
      </div>
    </div>
  )
}
