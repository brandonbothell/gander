import { FiChevronRight, FiLayout, FiPlus, FiTrash } from 'react-icons/fi'
import { useEffect, useState } from 'react'
import {
  useCounter,
  useDisclosure,
  useLocalStorage,
  useMap,
  useViewportSize,
} from '@mantine/hooks'
import {
  AppShell,
  Burger,
  Group,
  NavLink,
  ScrollArea,
  Space,
  Text,
  useMantineColorScheme,
  useMantineTheme,
} from '@mantine/core'
import { authFetch } from '../main'
import { ThemeToggle } from '../Component/ThemeToggle'
import StreamsGrid from '../Component/Streams/StreamsGrid'
import { SessionsLogoutButton } from '../Component/Sessions/SessionsLogoutButton'
import RecordingsPages from '../Component/Recordings/RecordingsPages'
import { type Stream } from '../../../source/types/shared'

export default function FullLayout(props: {
  logout: (skipBroadcast?: boolean) => Promise<void>
  lastFailedJwt: string | undefined
  setFailedJwt: React.Dispatch<React.SetStateAction<string | undefined>>
}) {
  const [openedMenu, { toggle: toggleMenu }] = useDisclosure()
  const [openedLayouts, { toggle: toggleLayouts }] = useDisclosure(true)
  const streams = useMap<string, Stream>()
  const [loadingStreams, setLoadingStreams] = useState(false)
  const [streamsLoaded, setStreamsLoaded] = useState(false)
  const [
    loadingFailed,
    { increment: incrementLoadingFailed, reset: resetLoadingFailed },
  ] = useCounter(0)
  const [layouts, setLayouts] = useLocalStorage<
    { id: number; splitterStreams: string[] }[]
  >({
    key: 'streamLayouts',
    defaultValue: [{ id: 0, splitterStreams: [] }],
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
  const { colorScheme } = useMantineColorScheme()

  const hasMouse = window.matchMedia('(pointer:fine)').matches

  useEffect(() => {
    if (loadingFailed < 3 && !loadingStreams && !streamsLoaded) {
      setLoadingStreams(true)
      authFetch('/api/streams')
        .then((res) => {
          if (!res.ok) {
            incrementLoadingFailed()
            setLoadingStreams(false)
            throw new Error(`Failed to fetch streams: ${res.statusText}`)
          }
          return res.json() as Promise<Stream[]>
        })
        .then((nextStreams) => {
          resetLoadingFailed()
          nextStreams.forEach((stream) => streams.set(stream.id, stream))
          setLoadingStreams(false)
          setStreamsLoaded(true)
        })
        .catch((err) => {
          incrementLoadingFailed()
          setLoadingStreams(false)
          throw new Error(`Failed to fetch streams: ${err}`)
        })
    }
  }, [streams, loadingStreams, loadingFailed, streamsLoaded])

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
          <ThemeToggle />
          <SessionsLogoutButton
            logout={props.logout}
            style={{
              zIndex: 1002,
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
            style={{ paddingLeft: 5 }}
            onClick={(e) => {
              e.preventDefault()
              toggleLayouts()
            }}
            leftSection={<FiLayout size={16} />}
            rightSection={
              <FiChevronRight
                size={16}
                style={{
                  transform: openedLayouts ? 'rotate(90deg)' : 'none',
                  transition: 'transform 200ms ease',
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
                  onClick={(e) => {
                    e.preventDefault()
                    setActiveLayout(id)
                    toggleMenu()
                  }}
                  style={
                    id === activeLayout
                      ? {
                          backgroundColor:
                            colorScheme === 'light'
                              ? colors.gray[2]
                              : colors.dark[6],
                        }
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
                          backgroundColor:
                            colorScheme === 'light' ? '#ff0000' : '#ab0000',
                          color:
                            colorScheme === 'light'
                              ? colors.gray[0]
                              : colors.gray[4],
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
                  key="create-layout-button"
                  leftSection={<FiPlus size={16} />}
                  onClick={(e) => {
                    setLayouts((prev) => {
                      const nextId =
                        prev.reduce(
                          (maxId, layout) => Math.max(maxId, layout.id),
                          -1,
                        ) + 1
                      return prev.concat({
                        id: nextId,
                        splitterStreams: [],
                      })
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
          layout={layouts.find((layout) => layout.id === activeLayout)!}
          setOnLayoutDeleted={setOnLayoutDeleted}
          setLayoutStreams={(streams) => {
            layouts[activeLayout].splitterStreams = streams
            setLayouts(layouts)
          }}
        />
        <Space h="md" />
        <RecordingsPages streams={streams} />
        <Text mt="xl">
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
