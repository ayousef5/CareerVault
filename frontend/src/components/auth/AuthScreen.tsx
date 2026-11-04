// The login / registration screen: one centred card with the CareerVault
// logo, a Log in / Create account switch, and the form. The sign-in logic
// (register, then log in, then onLogin) lives in api/authApi.ts.
import { useState } from 'react'
import { login, register } from '../../api/authApi'
import './AuthScreen.css'

type AuthScreenProps = {
  onLogin: () => void
}

function AuthScreen({ onLogin }: AuthScreenProps) {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [isRegistering, setIsRegistering] = useState(false)
  const [error, setError] = useState('')
  const [isSubmitting, setIsSubmitting] = useState(false)
  const [showPassword, setShowPassword] = useState(false)

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault()
    setError('')
    setIsSubmitting(true)

    try {
      if (isRegistering) {
        await register(email, password)
      }

      await login(email, password)
      onLogin()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong.')
    } finally {
      setIsSubmitting(false)
    }
  }

  // Switches between Log in and Create account (typed values are kept).
  function switchMode(registering: boolean) {
    setIsRegistering(registering)
    setError('')
  }

  return (
    <main className="auth-page">
      <div className="auth-card">
        <header className="auth-brand">
          <span className="logo-mark" aria-hidden="true">CV</span>
          <h1>CareerVault</h1>
          <p className="auth-tagline">Track applications. Save job postings. Stay organized.</p>
        </header>

        {/* Log in / Create account switch. */}
        <div className="auth-switch" role="group" aria-label="Choose log in or create account">
          <button
            type="button"
            className={isRegistering ? 'auth-switch-option' : 'auth-switch-option active'}
            aria-pressed={!isRegistering}
            disabled={isSubmitting}
            onClick={() => switchMode(false)}
          >
            Log in
          </button>
          <button
            type="button"
            className={isRegistering ? 'auth-switch-option active' : 'auth-switch-option'}
            aria-pressed={isRegistering}
            disabled={isSubmitting}
            onClick={() => switchMode(true)}
          >
            Create account
          </button>
        </div>

        <form className="auth-form" onSubmit={handleSubmit} aria-busy={isSubmitting}>
          <h2 className="auth-heading">{isRegistering ? 'Create your account' : 'Welcome back'}</h2>

          <div className="auth-field">
            <label htmlFor="email">Email</label>
            <input
              id="email"
              type="email"
              autoComplete="email"
              placeholder="you@example.com"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
            />
          </div>

          <div className="auth-field">
            <label htmlFor="password">Password</label>
            <div className="auth-password">
              <input
                id="password"
                type={showPassword ? 'text' : 'password'}
                autoComplete={isRegistering ? 'new-password' : 'current-password'}
                aria-describedby={isRegistering ? 'password-hint' : undefined}
                value={password}
                onChange={(event) => setPassword(event.target.value)}
                required
              />
              <button
                type="button"
                className="auth-show-password"
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? 'Hide' : 'Show'}
              </button>
            </div>
            {isRegistering && (
              <p id="password-hint" className="auth-hint">
                At least 6 characters, with upper- and lowercase letters, a number and a symbol.
              </p>
            )}
          </div>

          {error && (
            <p className="auth-error" role="alert">
              {error}
            </p>
          )}

          <button type="submit" className="auth-submit" disabled={isSubmitting}>
            {isSubmitting && <span className="auth-spinner" aria-hidden="true" />}
            {isSubmitting
              ? isRegistering
                ? 'Creating account…'
                : 'Logging in…'
              : isRegistering
                ? 'Create account'
                : 'Log in'}
          </button>
        </form>

        <p className="auth-footer">
          {isRegistering ? 'Already have an account?' : "Don't have an account?"}{' '}
          <button
            type="button"
            className="auth-link"
            disabled={isSubmitting}
            onClick={() => switchMode(!isRegistering)}
          >
            {isRegistering ? 'Log in' : 'Create one'}
          </button>
        </p>
      </div>
    </main>
  )
}

export default AuthScreen
