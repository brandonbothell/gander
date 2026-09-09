import { useCallback, useEffect, useRef } from 'react'
import {
  type SplitterPaneSize,
  useLocalStorage,
  type UseSplitterReturnValue,
  useViewportSize,
} from '@mantine/hooks'
import { type CSSProperties, Group, Splitter } from '@mantine/core'
import { type Stream } from '../../types'
import StreamVideo from './StreamVideo'

type StoredSplitterLayout = {
  sizes: SplitterPaneSize[]
  collapsed: boolean[]
}

export default function StreamsGrid(props: {
  streams: Stream[]
  layout: number
  setOnLayoutDeleted: React.Dispatch<
    React.SetStateAction<(layoutId: number) => void>
  >
}) {
  const splitterRef = useRef<UseSplitterReturnValue>(null)
  const splitter2Ref = useRef<UseSplitterReturnValue>(null)
  const splitter3Ref = useRef<UseSplitterReturnValue>(null)
  const splitters = [splitterRef, splitter2Ref, splitter3Ref]

  // eslint-disable-next-line func-call-spacing
  const [storedSplitterLayouts, setStoredSplitterLayouts] = useLocalStorage<
    (StoredSplitterLayout[] | null)[]
  >({
    key: 'splitterState',
    defaultValue: [
      [
        { sizes: [50, 50], collapsed: [false, false] },
        { sizes: [50, 50], collapsed: [false, false] },
        { sizes: [50, 50], collapsed: [false, false] },
      ],
    ],
  })

  const onLayoutDeleted = useCallback(
    (layoutId: number) => {
      setStoredSplitterLayouts((prev) => {
        if (!prev || !prev[layoutId]) return prev

        const next = [...prev]
        next[layoutId] = null
        return next
      })
    },
    [setStoredSplitterLayouts],
  )

  const getAspectRatio = useCallback(() => {
    if (splitterRef.current?.collapsed.includes(true)) {
      const uncollapsedIndex = splitterRef.current.collapsed.findIndex(
        (c) => c === false,
      )
      if (uncollapsedIndex === -1) return '16 / 9'
      if (splitters[uncollapsedIndex + 1].current?.collapsed.includes(true)) {
        return '16 / 9'
      } else return '16 / 18'
    }
    return '16 / 9'
  }, [splitterRef.current, splitter2Ref.current, splitter3Ref.current])

  const { width } = useViewportSize()
  const [splitterStyles, setSplitterStyles] = useLocalStorage<CSSProperties>({
    key: 'splitterStyles',
    defaultValue: {
      zIndex: 1000,
      aspectRatio: getAspectRatio(),
    },
  })

  useEffect(() => {
    props.setOnLayoutDeleted(onLayoutDeleted)
  }, [props.setOnLayoutDeleted])

  useEffect(() => {
    if (props.streams.length === 0) return

    if (!storedSplitterLayouts || !storedSplitterLayouts[props.layout]) {
      setStoredSplitterLayouts((prev) => {
        const next = prev ? [...prev] : []
        while (next.length <= props.layout) next.push(null)
        next[props.layout] ??= [
          { sizes: [50, 50], collapsed: [false, false] },
          { sizes: [50, 50], collapsed: [false, false] },
          { sizes: [50, 50], collapsed: [false, false] },
        ]
        return next
      })
      return
    }

    const layoutState = storedSplitterLayouts[props.layout]

    splitters.forEach((splitter, index) => {
      if (!splitter.current || !layoutState?.[index]) {
        return
      }
      splitter.current.setSizes(layoutState[index].sizes)
      splitter.current.collapsed = layoutState[index].collapsed
    })
  }, [
    setStoredSplitterLayouts,
    storedSplitterLayouts,
    props.layout,
    props.streams.length,
  ])

  useEffect(() => {
    if (props.streams.length === 0) return

    let previousState: string[] = ['', '', '', '']

    const saveSplitterState = () => {
      const splitter = splitterRef.current

      if (!splitter) {
        return
      }

      splitters.forEach((splitter, index) => {
        if (!splitter.current) return
        const state = {
          sizes: splitter.current.sizes,
          collapsed: splitter.current.collapsed,
        }
        const serializedState = JSON.stringify(state)

        if (serializedState !== previousState[index]) {
          previousState[index] = serializedState
          setStoredSplitterLayouts((prev) => {
            const newState = prev ? [...prev] : []
            if (!newState[props.layout]) newState[props.layout] = []
            newState[props.layout]![index] = state

            return newState
          })
        }
      })
    }

    const interval = window.setInterval(saveSplitterState, 500)

    return () => window.clearInterval(interval)
  }, [props.layout, props.streams.length])

  useEffect(() => {
    let cancelled = false
    const correctAspectRatio = () => {
      if (cancelled) return

      setSplitterStyles((prev) => ({
        ...prev,
        aspectRatio: getAspectRatio(),
      }))
    }

    const aspectRatioInterval = setInterval(correctAspectRatio, 100)

    return () => {
      clearInterval(aspectRatioInterval)
      cancelled = true
    }
  }, [])

  if (!props.streams || props.streams.length === 0) {
    return <div>No streams available</div>
  }

  return (
    <Group justify="center" mb="md">
      <Splitter
        style={splitterStyles}
        w={width < 768 ? '95vw' : undefined}
        h={width < 768 ? undefined : '70vh'}
        splitterRef={splitterRef}
        styles={{
          thumb: {
            transform:
              width >= 768 && splitterRef.current?.collapsed[1]
                ? 'translateX(0px)'
                : undefined,
            right: splitterRef.current?.collapsed[1]
              ? 10
              : splitterRef.current?.collapsed[0]
                ? -19
                : undefined,
          },
          handle: {
            transform:
              width >= 768 && splitterRef.current?.collapsed[1]
                ? 'translateX(-59px)'
                : undefined,
          },
        }}
      >
        <Splitter.Pane
          defaultSize={50}
          min={10}
          display={'initial'}
          collapsible
        >
          <Splitter
            splitterRef={splitter2Ref}
            orientation="vertical"
            h="100%"
            styles={{
              thumb: {
                bottom: (() => {
                  const splitter2 = splitter2Ref.current
                  if (!splitter2) return
                  if (splitter2.collapsed[0]) return -19
                  if (splitter2.collapsed[1]) return 10
                })(),
              },
            }}
            style={{
              aspectRatio:
                splitterRef.current?.collapsed[1] === true
                  ? getAspectRatio()
                  : undefined,
            }}
          >
            <Splitter.Pane defaultSize={50} min={10} bg="blue" collapsible>
              <StreamVideo
                stream={props.streams[0]}
                getAspectRatio={getAspectRatio}
              />
            </Splitter.Pane>
            <Splitter.Pane defaultSize={50} min={10} bg="violet" collapsible>
              <StreamVideo
                stream={props.streams[1]}
                getAspectRatio={getAspectRatio}
              />
            </Splitter.Pane>
          </Splitter>
        </Splitter.Pane>
        <Splitter.Pane
          defaultSize={50}
          min={10}
          display={'initial'}
          collapsible
        >
          <Splitter
            splitterRef={splitter3Ref}
            orientation="vertical"
            h="100%"
            styles={{
              thumb: {
                bottom: (() => {
                  const splitter3 = splitter3Ref.current
                  if (!splitter3) return
                  if (splitter3.collapsed[0]) return -19
                  if (splitter3.collapsed[1]) return 10
                })(),
              },
            }}
            style={{
              aspectRatio:
                splitterRef.current?.collapsed[0] === true
                  ? getAspectRatio()
                  : undefined,
            }}
          >
            <Splitter.Pane defaultSize={50} min={10} bg="teal" collapsible>
              Editor
            </Splitter.Pane>
            <Splitter.Pane defaultSize={50} min={10} bg="grape" collapsible>
              Terminal
            </Splitter.Pane>
          </Splitter>
        </Splitter.Pane>
      </Splitter>
    </Group>
  )
}
