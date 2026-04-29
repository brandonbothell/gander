import { useState } from 'react'
import { API_BASE } from './main'
import { Capacitor } from '@capacitor/core'
import { getDeviceFingerprint } from './utils/session'

export default function LoginPage({
  onLogin,
}: {
  onLogin: (token: string, refreshToken: string) => void
}) {
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [loading, setIsLoading] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setIsLoading(true)
    setError('')

    try {
      const deviceInfo = getDeviceFingerprint()

      const response = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, deviceInfo }),
      })

      const data = await response.json()
      if (data.success) {
        if (!Capacitor.isNativePlatform()) {
          localStorage.removeItem('tokenRefreshInProgress')
        }
        onLogin(data.token, data.refreshToken)
      } else {
        setError(data.message ?? 'Login failed')
      }
    } catch {
      setError('Login failed. Please try again.')
    } finally {
      setIsLoading(false)
    }
  }

  return (
    <div
      className="App"
      style={{
        minHeight: '100vh',
        justifyContent: 'center',
        alignItems: 'center',
        display: 'flex',
      }}
    >
      <form
        onSubmit={handleSubmit}
        style={{
          background: '#232b4a',
          padding: 32,
          borderRadius: 16,
          boxShadow: '0 2px 16px #1a2980',
          minWidth: 320,
        }}
        autoComplete="on"
      >
        <h2 style={{ color: '#fff', marginBottom: 24 }}>Login</h2>
        <div style={{ marginBottom: 16 }}>
          <input
            type="text"
            placeholder="Username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            style={{
              width: 220,
              padding: 8,
              borderRadius: 6,
              border: '1px solid #444',
            }}
            autoFocus
            autoComplete="username"
            disabled={loading}
          />
        </div>
        <div style={{ marginBottom: 16 }}>
          <input
            type="password"
            placeholder="Password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            style={{
              width: 220,
              padding: 8,
              borderRadius: 6,
              border: '1px solid #444',
            }}
            autoComplete="current-password"
            disabled={loading}
          />
        </div>
        {error && (
          <div style={{ color: '#ff5f5f', marginBottom: 12 }}>{error}</div>
        )}
        <button
          type="submit"
          style={{
            width: 220,
            padding: 10,
            borderRadius: 8,
            background: '#1a2980',
            color: '#fff',
            border: 'none',
            fontWeight: 'bold',
            fontSize: '1em',
            cursor: loading ? 'not-allowed' : 'pointer',
            opacity: loading ? 0.7 : 1,
          }}
          disabled={loading}
        >
          {loading ? 'Logging in...' : 'Log In'}
        </button>
      </form>
    </div>
  )
}
