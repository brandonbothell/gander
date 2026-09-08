import { FiChevronRight, FiLayout, FiPlus, FiTrash } from 'react-icons/fi'
import { useEffect, useState } from 'react'
import { useDisclosure, useLocalStorage, useViewportSize } from '@mantine/hooks'
import {
  AppShell,
  Burger,
  Group,
  NavLink,
  ScrollArea,
  Text,
  useMantineTheme,
} from '@mantine/core'
import { authFetch } from '../main'
import StreamsGrid from '../Component/Streams/StreamsGrid'
import { SessionsLogoutButton } from '../Component/Sessions/SessionsLogoutButton'
import RecordingsPages from '../Component/Recordings/RecordingsPages'
import { type Stream } from '../../../source/types/shared'

export default function FullLayout(props: {
  logout: (skipBroadcast?: boolean) => Promise<void>
}) {
  const [openedMenu, { toggle: toggleMenu }] = useDisclosure()
  const [openedLayouts, { toggle: toggleLayouts }] = useDisclosure(true)
  const jwt = useLocalStorage({
    key: 'jwt',
  })
  const [streams, setStreams] = useState<Stream[]>([])
  const [layouts, setLayouts] = useLocalStorage<{ id: number }[]>({
    key: 'streamLayouts',
    defaultValue: [{ id: 0 }],
  })
  const [hoveredLayouts, setHoveredLayouts] = useState<number[]>([])
  const [activeLayout, setActiveLayout] = useLocalStorage<number>({
    key: 'activeLayout',
    defaultValue: 0,
  })
  // eslint-disable-next-line func-call-spacing
  const [onLayoutDeleted, setOnLayoutDeleted] = useState<
    (layoutId: number) => void
  >(() => {
    /* empty */
  })

  const { width } = useViewportSize()
  const { colors } = useMantineTheme()
  const hasMouse = window.matchMedia('(pointer:fine)').matches

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
      navbar={{
        width: 300,
        breakpoint: 1200,
        collapsed: { mobile: !openedMenu },
      }}
      aside={{
        width: 300,
        breakpoint: 1500,
        collapsed: { desktop: false, mobile: true },
      }}
      padding="md"
    >
      <AppShell.Header zIndex={1001} style={{ pointerEvents: 'none' }}>
        <Group h="100%" w="100%" px="md">
          <Burger
            opened={openedMenu}
            onClick={toggleMenu}
            size="sm"
            style={{
              pointerEvents: 'auto',
              display: width < 1200 ? 'initial' : 'none',
            }}
          />
          Gander
          <SessionsLogoutButton
            logout={props.logout}
            style={{
              marginLeft: 'auto',
              pointerEvents: 'auto',
            }}
          />
        </Group>
        <Group h="100%" w="50%" px="md"></Group>
      </AppShell.Header>
      <AppShell.Navbar zIndex={1001} p="md">
        <AppShell.Section p="md">Navbar header</AppShell.Section>
        <AppShell.Section grow my="md" component={ScrollArea} px="md">
          <NavLink
            href="#"
            label="Layouts"
            style={{ paddingLeft: 0 }}
            onClick={() => {
              toggleLayouts()
            }}
            leftSection={<FiLayout size={16} />}
            rightSection={
              <FiChevronRight
                size={16}
                style={{
                  transform: openedLayouts ? 'rotate(-90deg)' : 'none',
                }}
              />
            }
          />

          {openedLayouts &&
            layouts
              .map(({ id }) => (
                <NavLink
                  href="#"
                  key={id}
                  onClick={(event) => {
                    event.preventDefault()
                    setActiveLayout(id)
                    toggleMenu()
                  }}
                  style={
                    id === activeLayout
                      ? { backgroundColor: colors.dark[6] }
                      : undefined
                  }
                  onPointerOver={() =>
                    setHoveredLayouts((prev) => prev.concat(id))
                  }
                  onPointerLeave={() =>
                    setHoveredLayouts((prev) => prev.filter((i) => i !== id))
                  }
                  label={`Layout ${id}`}
                  rightSection={
                    id !== 0 && (
                      <FiTrash
                        size={24}
                        style={{
                          display: hasMouse
                            ? hoveredLayouts.includes(id)
                              ? 'block'
                              : 'none'
                            : 'block',
                          backgroundColor: '#ab0000',
                          padding: 4,
                          borderRadius: 4,
                        }}
                        onClick={(e) => {
                          e.preventDefault()
                          e.stopPropagation()

                          setLayouts((prev) =>
                            prev.filter((layout) => layout.id !== id),
                          )
                          if (activeLayout === id) setActiveLayout(0)
                          if (onLayoutDeleted) onLayoutDeleted(id)
                        }}
                      />
                    )
                  }
                />
              ))
              .concat(
                <NavLink
                  href="#"
                  label="Create layout"
                  leftSection={<FiPlus size={16} />}
                  onClick={(e) => {
                    setLayouts((prev) => {
                      const nextId =
                        prev.reduce(
                          (maxId, layout) => Math.max(maxId, layout.id),
                          -1,
                        ) + 1
                      return prev.concat({ id: nextId })
                    })
                    e.preventDefault()
                  }}
                />,
              )}
        </AppShell.Section>
        <AppShell.Section p="md">
          Navbar footer – always at the bottom
        </AppShell.Section>
      </AppShell.Navbar>
      <AppShell.Main style={{ display: 'grid' }}>
        <StreamsGrid
          streams={streams}
          layout={activeLayout}
          setOnLayoutDeleted={setOnLayoutDeleted}
        />
        <RecordingsPages streams={streams} />
        <Text mt="sm">
          AppShell example with all elements: Navbar, Header, Aside, Footer.
        </Text>
        <Text>All elements except AppShell.Main have fixed position.</Text>
        <Text>
          Aside is hidden on on md breakpoint and cannot be opened when it is
          collapsed
        </Text>
      </AppShell.Main>
      <AppShell.Aside p="md">Aside</AppShell.Aside>
      <AppShell.Footer p="md">
        Gander © 2026 Brandon Bothell. All rights reserved. - Privacy is a right
      </AppShell.Footer>
    </AppShell>
  )
}
