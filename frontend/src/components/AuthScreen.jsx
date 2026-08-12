import { useState } from 'react'
import { ArrowRight } from 'lucide-react'
import { Button, Field, Input } from './ui.jsx'

export default function AuthScreen({ onLogin }) {
  const [form, setForm] = useState({
    username: '',
    password: '',
  })
  const [submitting, setSubmitting] = useState(false)

  async function handleSubmit(event) {
    event.preventDefault()
    setSubmitting(true)

    try {
      await onLogin(form)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <main className="relative flex min-h-screen flex-col items-center justify-center overflow-hidden p-4">
      <div className="relative z-10 mb-8 flex items-center gap-3">
        <img src="/logo_white.png" alt="Logo" className="h-10 w-auto object-contain" />
        <span className="text-2xl font-bold tracking-tight text-white">
          Mail <span className="text-[#38bdf8]">Dashboard</span>
        </span>
      </div>

      <div className="relative z-10 w-full max-w-md rounded-2xl border border-white/10 bg-[#262626]/80 p-8 shadow-2xl backdrop-blur-xl transition-all duration-300">
        <div className="mb-8 text-center">
          <h2 className="mb-2 text-2xl font-bold text-white">Welcome back</h2>
        </div>

        <form className="space-y-4" onSubmit={handleSubmit}>
          <Field label="Username">
            <Input
              autoFocus
              autoComplete="username"
              value={form.username}
              onChange={(event) => setForm((current) => ({ ...current, username: event.target.value }))}
              placeholder="admin"
              required
            />
          </Field>

          <Field label="Password">
            <Input
              type="password"
              autoComplete="current-password"
              value={form.password}
              onChange={(event) => setForm((current) => ({ ...current, password: event.target.value }))}
              placeholder="••••••••"
              required
            />
          </Field>

          <Button type="submit" size="lg" className="w-full justify-center" icon={ArrowRight} loading={submitting}>
            Sign In
          </Button>
        </form>
      </div>
    </main>
  )
}
