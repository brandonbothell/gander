import { lazy, useCallback, useEffect, useRef, useState } from 'react'
import {
  type SplitterPaneSize,
  useLocalStorage,
  type UseSplitterReturnValue,
  useViewportSize,
} from '@mantine/hooks'
import { type CSSProperties, Group, Splitter } from '@mantine/core'
import { type Stream } from '../../types'
import StreamVideo from './StreamVideo'
const StreamAddButton = lazy(() => import('./StreamAddButton/StreamAddButton'))

type StoredSplitterLayout = {
  sizes: SplitterPaneSize[]
  collapsed: boolean[]
  streamId?: string
}

export default function StreamsGrid(props: {
  streams: Map<string, Stream>
  motionStatus: {
    [streamId: string]: {
      detectingMotion: boolean
      recording: boolean
      secondsLeft: number
      saving: boolean
      startedRecordingAt: number
      lowDiskSpace: boolean
    }
  }
  setMotionStatus: React.Dispatch<
    React.SetStateAction<{
      [streamId: string]: {
        detectingMotion: boolean
        recording: boolean
        secondsLeft: number
        saving: boolean
        startedRecordingAt: number
        lowDiskSpace: boolean
      }
    }>
  >
  layout: { id: number; splitterStreams: string[] }
  setLayouts: (
    val:
      | {
          id: number
          splitterStreams: string[]
        }[]
      | ((
          prevState: {
            id: number
            splitterStreams: string[]
          }[],
        ) => {
          id: number
          splitterStreams: string[]
        }[]),
  ) => void
  setLayoutStreams: (streams: string[]) => void | Promise<void>
  setOnLayoutDeleted: React.Dispatch<
    React.SetStateAction<(layoutId: number) => void>
  >
}) {
  const splitterRef = useRef<UseSplitterReturnValue>(null)
  const splitter2Ref = useRef<UseSplitterReturnValue>(null)
  const splitter3Ref = useRef<UseSplitterReturnValue>(null)
  const splitters = [splitterRef, splitter2Ref, splitter3Ref]

  const { width, height } = useViewportSize()

  // eslint-disable-next-line func-call-spacing
  const [storedSplitterLayouts, setStoredSplitterLayouts] = useLocalStorage<
    (StoredSplitterLayout[] | null)[]
  >({
    key: 'splitterState',
    defaultValue: [],
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

  const getSplitterDimensions = (aspectRatio: string) => {
    const ratio = 16 / Number(aspectRatio.split('/')[1])
    const maxHeight = Math.max(
      0,
      Math.min(
        height - 16,
        width >= 768 && height >= 450 ? height * 0.75 : height - 16,
      ),
    )
    const splitterWidth = Math.max(
      0,
      Math.min(
        width * (width < 768 ? 0.9 : 0.6),
        width - 16,
        maxHeight * ratio,
      ),
    )

    return { width: splitterWidth, height: splitterWidth / ratio, maxHeight }
  }

  const [splitterStyles, setSplitterStyles] = useState<CSSProperties>(() => {
    const aspectRatio = getAspectRatio()
    const dimensions = getSplitterDimensions(aspectRatio)
    return {
      ...dimensions,
      maxWidth: 'calc(100vw - 16px)',
      aspectRatio,
      zIndex: 1000,
    }
  })

  useEffect(() => {
    props.setOnLayoutDeleted(() => onLayoutDeleted)
  }, [props.setOnLayoutDeleted])

  useEffect(() => {
    if (props.streams.size === 0) return

    if (!storedSplitterLayouts || !storedSplitterLayouts[props.layout.id]) {
      setStoredSplitterLayouts((prev) => {
        const next = prev ? [...prev] : []
        while (next.length <= props.layout.id) next.push(null)
        next[props.layout.id] ??= [
          {
            sizes: [50, 50],
            collapsed: [false, false],
          },
          {
            sizes: [50, 50],
            collapsed: [false, false],
          },
          {
            sizes: [50, 50],
            collapsed: [false, false],
          },
        ]
        return next
      })
      return
    }

    const layoutState = storedSplitterLayouts[props.layout.id]

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
    props.layout.id,
    props.streams.size,
  ])

  useEffect(() => {
    if (props.streams.size === 0 || !storedSplitterLayouts[props.layout.id]) {
      return
    }

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
            if (!newState[props.layout.id]) newState[props.layout.id] = []
            newState[props.layout.id]![index] = state

            return newState
          })
        }
      })
    }

    const interval = window.setInterval(saveSplitterState, 500)

    return () => window.clearInterval(interval)
  }, [props.layout.id, props.streams.size, storedSplitterLayouts])

  useEffect(() => {
    let cancelled = false
    const correctAspectRatio = () => {
      if (cancelled) return

      const aspectRatio = getAspectRatio()
      const dimensions = getSplitterDimensions(aspectRatio)

      setSplitterStyles({
        ...dimensions,
        maxWidth: 'calc(100vw - 16px)',
        aspectRatio,
        zIndex: 1000,
      })
    }

    const aspectRatioInterval = setInterval(correctAspectRatio, 100)

    return () => {
      clearInterval(aspectRatioInterval)
      cancelled = true
    }
  }, [width, height])

  const splitterStreams = props.layout.splitterStreams

  return (
    <Group mb="md" display={'flex'} justify="center">
      <Splitter style={splitterStyles} splitterRef={splitterRef}>
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
            style={{
              aspectRatio:
                splitterRef.current?.collapsed[1] === true
                  ? getAspectRatio()
                  : undefined,
            }}
          >
            <Splitter.Pane defaultSize={50} min={10} bg="blue" collapsible>
              {splitterStreams?.[0] && props.streams.get(splitterStreams[0]) ? (
                <StreamVideo
                  setStream={(streamId) => {
                    splitterStreams[0] = streamId
                    props.setLayoutStreams(splitterStreams)
                  }}
                  setMotionStatus={props.setMotionStatus}
                  setLayouts={props.setLayouts}
                  stream={props.streams.get(splitterStreams[0])!}
                  streams={props.streams}
                  motionStatus={props.motionStatus[splitterStreams[0]!]}
                  getAspectRatio={getAspectRatio}
                  removeFromLayout={() => {
                    delete splitterStreams[0]
                    props.setLayoutStreams(splitterStreams)
                  }}
                />
              ) : (
                <Splitter.Pane defaultSize={50} min={10} bg="blue" collapsible>
                  <StreamAddButton
                    color="grape"
                    streams={props.streams}
                    setLayouts={props.setLayouts}
                    setStream={(streamId) => {
                      splitterStreams[0] = streamId
                      props.setLayoutStreams(splitterStreams)
                    }}
                  />
                </Splitter.Pane>
              )}
            </Splitter.Pane>
            <Splitter.Pane defaultSize={50} min={10} bg="violet" collapsible>
              {splitterStreams?.[1] && props.streams.get(splitterStreams[1]) ? (
                <StreamVideo
                  streams={props.streams}
                  stream={props.streams.get(splitterStreams[1])!}
                  motionStatus={props.motionStatus[splitterStreams[1]!]}
                  setMotionStatus={props.setMotionStatus}
                  setLayouts={props.setLayouts}
                  getAspectRatio={getAspectRatio}
                  removeFromLayout={() => {
                    delete splitterStreams[1]
                    props.setLayoutStreams(splitterStreams)
                  }}
                  setStream={(streamId) => {
                    splitterStreams[1] = streamId
                    props.setLayoutStreams(splitterStreams)
                  }}
                />
              ) : (
                <Splitter.Pane
                  defaultSize={50}
                  min={10}
                  bg="violet"
                  collapsible
                >
                  <StreamAddButton
                    color="teal"
                    setLayouts={props.setLayouts}
                    streams={props.streams}
                    setStream={(streamId) => {
                      splitterStreams[1] = streamId
                      props.setLayoutStreams(splitterStreams)
                    }}
                  />
                </Splitter.Pane>
              )}
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
            style={{
              aspectRatio:
                splitterRef.current?.collapsed[0] === true
                  ? getAspectRatio()
                  : undefined,
            }}
          >
            <Splitter.Pane defaultSize={50} min={10} bg="teal" collapsible>
              {splitterStreams?.[2] && props.streams.get(splitterStreams[2]) ? (
                <StreamVideo
                  stream={props.streams.get(splitterStreams[2])!}
                  streams={props.streams}
                  motionStatus={props.motionStatus[splitterStreams[2]!]}
                  setMotionStatus={props.setMotionStatus}
                  getAspectRatio={getAspectRatio}
                  setLayouts={props.setLayouts}
                  removeFromLayout={() => {
                    delete splitterStreams[2]
                    props.setLayoutStreams(splitterStreams)
                  }}
                  setStream={(streamId) => {
                    splitterStreams[2] = streamId
                    props.setLayoutStreams(splitterStreams)
                  }}
                />
              ) : (
                <Splitter.Pane defaultSize={50} min={10} bg="teal" collapsible>
                  <StreamAddButton
                    color="violet"
                    setLayouts={props.setLayouts}
                    streams={props.streams}
                    setStream={(streamId) => {
                      splitterStreams[2] = streamId
                      props.setLayoutStreams(splitterStreams)
                    }}
                  />
                </Splitter.Pane>
              )}
            </Splitter.Pane>
            <Splitter.Pane defaultSize={50} min={10} bg="grape" collapsible>
              {splitterStreams?.[3] && props.streams.get(splitterStreams[3]) ? (
                <StreamVideo
                  stream={props.streams.get(splitterStreams[3])!}
                  streams={props.streams}
                  motionStatus={props.motionStatus[splitterStreams[3]!]}
                  setMotionStatus={props.setMotionStatus}
                  getAspectRatio={getAspectRatio}
                  setLayouts={props.setLayouts}
                  removeFromLayout={() => {
                    delete splitterStreams[3]
                    props.setLayoutStreams(splitterStreams)
                  }}
                  setStream={(streamId) => {
                    splitterStreams[3] = streamId
                    props.setLayoutStreams(splitterStreams)
                  }}
                />
              ) : (
                <Splitter.Pane defaultSize={50} min={10} bg="grape" collapsible>
                  <StreamAddButton
                    color="blue"
                    setLayouts={props.setLayouts}
                    streams={props.streams}
                    setStream={(streamId) => {
                      splitterStreams[3] = streamId
                      props.setLayoutStreams(splitterStreams)
                    }}
                  />
                </Splitter.Pane>
              )}
            </Splitter.Pane>
          </Splitter>
        </Splitter.Pane>
      </Splitter>
    </Group>
  )
}
