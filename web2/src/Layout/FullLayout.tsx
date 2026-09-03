import { useEffect, useState } from 'react'
import { useDisclosure, useLocalStorage } from '@mantine/hooks'
import { AppShell, Burger, Text, Group } from '@mantine/core'
import { authFetch } from '../main'
import StreamsDisplay from '../Component/StreamsDisplay'
import { SessionsLogoutButton } from '../Component/SessionsLogoutButton'
import { type Stream } from '../../../source/types/shared'
// import StreamVideoLayout from './StreamVideoLayout'

export default function FullLayout(props: {
  logout: (skipBroadcast?: boolean) => Promise<void>
}) {
  const [opened, { toggle }] = useDisclosure()
  const jwt = useLocalStorage({
    key: 'jwt',
  })
  const [streams, setStreams] = useState<Stream[]>([])
  const activeStream = useLocalStorage({
    key: 'stream',
  })

  useEffect(() => {
    let cancelled = false

    authFetch('/api/streams', {
      headers: { Authorization: `Bearer ${jwt}` },
    })
      .then((res) => {
        if (!res.ok) {
          throw new Error(`Failed to fetch streams: ${res.statusText}`)
        }
        return res.json() as Promise<Stream[]>
      })
      .then((nextStreams) => {
        if (!cancelled) setStreams(nextStreams)
      })

    return () => {
      cancelled = true
    }
  }, [])

  return (
    <AppShell
      header={{ height: 60 }}
      footer={{ height: 60 }}
      navbar={{ width: 300, breakpoint: 'sm', collapsed: { mobile: !opened } }}
      aside={{
        width: 300,
        breakpoint: 'md',
        collapsed: { desktop: false, mobile: true },
      }}
      padding="md"
    >
      <AppShell.Header zIndex={1001}>
        <Group h="100%" w="100%" px="md">
          <Burger opened={opened} onClick={toggle} hiddenFrom="sm" size="sm" />
          Gander
          <SessionsLogoutButton
            logout={props.logout}
            style={{
              marginLeft: 'auto',
            }}
          />
        </Group>
        <Group h="100%" w="50%" px="md"></Group>
      </AppShell.Header>
      <AppShell.Navbar zIndex={1001} p="md">
        Navbar
      </AppShell.Navbar>
      <AppShell.Main style={{ display: 'grid', justifyContent: 'center' }}>
        <StreamsDisplay streams={streams} />
        {/* <StreamVideoLayout /> */}
        <Text>
          AppShell example with all elements: Navbar, Header, Aside, Footer.
        </Text>
        <Text>All elements except AppShell.Main have fixed position.</Text>
        <Text>
          Aside is hidden on on md breakpoint and cannot be opened when it is
          collapsed
        </Text>
        {/* <LoadingOverlay visible={streams instanceof Promise} />*/}
      </AppShell.Main>
      <AppShell.Aside p="md">Aside</AppShell.Aside>
      <AppShell.Footer p="md">
        Gander © 2026 Brandon Bothell. All rights reserved. - Privacy is a right
      </AppShell.Footer>
    </AppShell>
  )
}
