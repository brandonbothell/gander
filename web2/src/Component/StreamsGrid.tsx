import { useCallback, useEffect, useRef } from 'react'
import {
  type SplitterPaneSize,
  useLocalStorage,
  type UseSplitterReturnValue,
  useViewportSize,
} from '@mantine/hooks'
import { type CSSProperties, Group, Splitter } from '@mantine/core'
import { type Stream } from 'c:/Users/shado/Documents/_GitRepositories/gander/source/types/shared'
import StreamVideo from './StreamVideo'

export default function StreamsGrid(props: { streams: Stream[] }) {
  if (!props.streams || props.streams.length === 0) {
    return <div>No streams available</div>
  }

  const splitterRef = useRef<UseSplitterReturnValue>(null)
  const splitter2Ref = useRef<UseSplitterReturnValue>(null)
  const splitter3Ref = useRef<UseSplitterReturnValue>(null)
  const splitters = [splitterRef, splitter2Ref, splitter3Ref]

  const [storedSplitterState, setStoredSplitterState] = useLocalStorage<
    {
      sizes: SplitterPaneSize[]
      collapsed: boolean[]
    }[]
  >({
    key: 'splitterState',
  })

  const getAspectRatio = useCallback(() => {
    if (splitterRef.current?.collapsed.includes(true)) {
      const uncollapsedIndex = splitterRef.current.collapsed.findIndex(
        (c) => c === false,
      )
      if (splitters[uncollapsedIndex + 1].current?.collapsed.includes(true)) {
        return '16 / 9'
      } else return '16 / 18'
    }
    return '16 / 9'
  }, [splitterRef, splitter2Ref, splitter3Ref])

  const { width } = useViewportSize()
  const [splitterStyles, setSplitterStyles] = useLocalStorage<CSSProperties>({
    key: 'splitterStyles',
    defaultValue: {
      zIndex: 1000,
      aspectRatio: getAspectRatio(),
    },
  })

  useEffect(() => {
    if (localStorage.getItem('splitterState')) return
    if (width !== 0 && width < 768) {
      setStoredSplitterState([
        { sizes: [100, 0], collapsed: [false, true] },
        { sizes: [50, 50], collapsed: [false, false] },
        { sizes: [50, 50], collapsed: [false, false] },
      ])
    }
  }, [setStoredSplitterState, width])

  useEffect(() => {
    if (!storedSplitterState) {
      return
    }

    splitters.forEach((splitter, index) => {
      if (!splitter.current || !storedSplitterState[index]) return
      splitter.current!.setSizes(storedSplitterState[index].sizes)
      splitter.current!.collapsed = storedSplitterState[index].collapsed
    })
  }, [storedSplitterState])

  useEffect(() => {
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
          setStoredSplitterState((prev) => {
            const newState = prev ? [...prev] : []
            newState[index] = state
            return newState
          })
        }
      })
    }

    const interval = window.setInterval(saveSplitterState, 2000)

    return () => window.clearInterval(interval)
  }, [setStoredSplitterState])

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

  return (
    <Group justify="center">
      <Splitter
        style={splitterStyles}
        w={width < 768 ? '95vw' : undefined}
        h={width < 768 ? undefined : '70vh'}
        splitterRef={splitterRef}
      >
        <Splitter.Pane
          defaultSize={50}
          min={10}
          display={'initial'}
          collapsible
        >
          <Splitter splitterRef={splitter2Ref} orientation="vertical" h="100%">
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
          <Splitter splitterRef={splitter3Ref} orientation="vertical" h="100%">
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
