import { useEffect, useRef, useState } from 'react'
import { useForm } from '@mantine/form'
import {
  Alert,
  Anchor,
  Button,
  Center,
  Container,
  Group,
  Paper,
  PasswordInput,
  Stack,
  Text,
  TextInput,
  Title,
} from '@mantine/core'
import { API_BASE } from '../main'
import { getDeviceFingerprint } from '../device-info'

type LoginValues = {
  username: string
  password: string
}

type LoginLayoutProps = {
  onLogin: (token: string, refreshToken: string) => void
  setAuthenticated: (authenticated: boolean) => void
}

export default function LoginLayout({
  onLogin,
  setAuthenticated,
}: LoginLayoutProps) {
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [ctrlHeld, setCtrlHeld] = useState(false)
  const [mobileApiKeyVisible, setMobileApiKeyVisible] = useState(false)
  const touchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const form = useForm<LoginValues>({
    mode: 'uncontrolled',
    initialValues: { username: '', password: '' },
    validate: {
      username: (value) => (value.trim() ? null : 'Username is required'),
      password: (value) => (value ? null : 'Password is required'),
    },
  })

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => setCtrlHeld(event.ctrlKey)
    const handleKeyUp = (event: KeyboardEvent) => setCtrlHeld(event.ctrlKey)

    window.addEventListener('keydown', handleKeyDown)
    window.addEventListener('keyup', handleKeyUp)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
      window.removeEventListener('keyup', handleKeyUp)
      if (touchTimeoutRef.current) clearTimeout(touchTimeoutRef.current)
    }
  }, [])

  useEffect(() => {
    if (!mobileApiKeyVisible) return
    const hideTimer = setTimeout(() => setMobileApiKeyVisible(false), 10000)
    return () => clearTimeout(hideTimer)
  }, [mobileApiKeyVisible])

  const handleTouchStart = () => {
    touchTimeoutRef.current = setTimeout(
      () => setMobileApiKeyVisible(true),
      2000,
    )
  }

  const handleTouchEnd = () => {
    if (touchTimeoutRef.current) {
      clearTimeout(touchTimeoutRef.current)
      touchTimeoutRef.current = null
    }
  }

  const handleLoginWithApiKey = () => {
    const apiKey = form.getValues().password
    if (apiKey) {
      localStorage.setItem('ak', btoa(apiKey))
      setAuthenticated(true)
    }
  }

  const handleSubmit = async ({ username, password }: LoginValues) => {
    setLoading(true)
    setError('')

    try {
      const deviceInfo = await getDeviceFingerprint()
      const response = await fetch(`${API_BASE}/api/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username, password, deviceInfo }),
      })
      const data = await response.json()

      if (data.success) {
        localStorage.removeItem('tokenRefreshInProgress')
        onLogin(data.token, data.refreshToken)
      } else {
        setError(data.message ?? 'Login failed')
      }
    } catch {
      setError('Login failed. Please try again.')
    } finally {
      setLoading(false)
    }
  }

  return (
    <Center mih="100vh" px="md">
      <Container size={420} w="100%">
        <Paper withBorder shadow="md" p="xl" radius="md">
          <Stack gap="lg">
            <div>
              <Title order={2}>Log in to Gander</Title>
              <Text c="dimmed" size="sm" mt={4}>
                Privacy is your right.
              </Text>
            </div>
            <form onSubmit={form.onSubmit(handleSubmit)} autoComplete="on">
              <Stack gap="md">
                <TextInput
                  label="Username"
                  placeholder="Username"
                  autoFocus
                  autoComplete="username"
                  key={form.key('username')}
                  {...form.getInputProps('username')}
                  disabled={loading}
                />
                <PasswordInput
                  label="Password"
                  placeholder="Password"
                  autoComplete="current-password"
                  key={form.key('password')}
                  {...form.getInputProps('password')}
                  disabled={loading}
                />
                {error && <Alert color="red">{error}</Alert>}
                <Button
                  type="submit"
                  loading={loading}
                  fullWidth
                  onTouchStart={handleTouchStart}
                  onTouchEnd={handleTouchEnd}
                >
                  Log in
                </Button>
                {(ctrlHeld || mobileApiKeyVisible) && (
                  <Group justify="center">
                    <Anchor
                      component="button"
                      type="button"
                      onClick={handleLoginWithApiKey}
                      disabled={loading}
                      size="sm"
                    >
                      Login with API Key
                    </Anchor>
                  </Group>
                )}
              </Stack>
            </form>
          </Stack>
        </Paper>
      </Container>
    </Center>
  )
}
