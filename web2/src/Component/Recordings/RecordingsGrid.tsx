import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { IconArrowsMaximize, IconArrowsMinimize } from '@tabler/icons-react'
import { useDisclosure, useMap, useViewportSize } from '@mantine/hooks'
import {
  Paper,
  SimpleGrid,
  Text,
  Image,
  LoadingOverlay,
  Center,
  ActionIcon,
  Grid,
} from '@mantine/core'
import { useVideo, Video } from '@gfazioli/mantine-video'
import CollapsedLightbox, {
  type CollapsedLightboxSlideData,
} from '../Lightbox/CollapsedLightbox'
import { Recording, Stream } from '../../types'
import { API_BASE, authFetch, fetchWithRetry } from '../../main'
import { onRecordingDeleted } from '../../event-listeners'
import classes from './RecordingsGrid.module.css'

export type SignedThumbnailUrl = {
  filename: string
  url: string
  expiresAt: number
}

export type SignedUrlsCache = Map<
  string,
  Map<number, (SignedThumbnailUrl | null)[]>
>

export default function RecordingsGrid(props: {
  currentPage: (Recording & { page: number; index: number })[]
  recordings: Map<string, (Recording & { page: number; index: number })[][]>
  recordingsCount: Map<string, number>
  pageLoading: boolean
  activeStream?: Stream
  signedUrlsCache: SignedUrlsCache
  signedUrlRequests: Map<string, Promise<void>>
}) {
  const signedUrlsMap = props.signedUrlsCache
  const loadedThumbnailMap = useMap<string, boolean>()

  const { width } = useViewportSize()
  const { canFullscreen } = useVideo()
  const [loading, setLoading] = useState(false)
  // eslint-disable-next-line func-call-spacing
  const [activeRecording, setRecording] = useState<
    (Recording & { page: number; index: number }) | null
  >(null)
  const videoRef = useRef<HTMLDivElement>(null)
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(
    null,
  )
  const [inlineFullscreen, setInlineFullscreen] = useState(false)
  const recordingRequestId = useRef(0)

  const setVideoContainer = useCallback((element: HTMLDivElement | null) => {
    videoRef.current = element
    setVideoElement(element?.getElementsByTagName('video')[0] ?? null)
  }, [])

  const fetchRecordingUrl = useCallback(
    async (currentUrl?: string, force = false) => {
      if (!activeRecording) return

      const parsedUrl = currentUrl ? URL.parse(currentUrl) : null
      const expires = Number(parsedUrl?.searchParams.get('expires'))
      const isFresh =
        parsedUrl &&
        Number.isFinite(expires) &&
        expires * 1000 - 5_000 >= Date.now()

      if (!force && isFresh) return currentUrl

      const requestId = ++recordingRequestId.current
      const url = `${API_BASE}/api/signed-url/${activeRecording.streamId}?type=video&filename=${activeRecording.filename}`

      try {
        const response = await fetchWithRetry(() => authFetch(url))
        const signedUrl = `${API_BASE}${(await response.json()).url}`

        if (requestId !== recordingRequestId.current) return
        return signedUrl
      } catch {
        if (requestId !== recordingRequestId.current) return
        console.error('Failed to fetch signed stream URL')
      }
    },
    [activeRecording],
  )

  const currentLightboxIndex = useMemo(
    () =>
      props.currentPage.findIndex((recording) => {
        if (activeRecording) {
          return (
            recording.filename === activeRecording.filename &&
            recording.streamId === activeRecording.streamId
          )
        }
      }),
    [props.currentPage, activeRecording],
  )
  const [lightboxOpen, { set: setLightboxOpen }] = useDisclosure(false)
  const lightboxSlides = useMemo<CollapsedLightboxSlideData[]>(
    () =>
      props.currentPage.map((recording) => ({
        type: 'custom',
        recording,
        title: (
          <Grid gap={0}>
            {recording.nickname ? (
              <Grid.Col span={'content'}>
                <Text span>{recording.nickname}&nbsp;&mdash;&nbsp;</Text>
              </Grid.Col>
            ) : null}
            <Grid.Col span={'content'}>
              <Text span>
                {formatTime(recording.duration)}&nbsp;&mdash;&nbsp;
              </Text>
            </Grid.Col>
            <Grid.Col span={'content'}>
              <Text span>{formatTimestamp(recording.filename)}</Text>
            </Grid.Col>
          </Grid>
        ),
        /* <>
            {recording.nickname ? `"${recording.nickname}"` : ''}
            {recording.nickname ? <>&nbsp;&mdash;&nbsp;</> : null}
            {formatTime(recording.duration)}
            <>&nbsp;&mdash;&nbsp;</>
            {formatTimestamp(recording.filename)}
          </> */
        autoPlay: true,
        render: ({ active }) => (
          <Center h="100%" w="100%" display={'grid'} pos="relative">
            {active && (
              <>
                <LoadingOverlay
                  visible={loading}
                  zIndex={2000}
                  overlayProps={{ radius: 'sm', blur: 2 }}
                />
                <div
                  className={
                    inlineFullscreen && width < 500
                      ? classes.inlineFullscreenFrame
                      : classes.videoFrame
                  }
                >
                  <Video
                    autoPlay
                    muted
                    shortcuts
                    controls={false}
                    ref={setVideoContainer}
                    h={'100%'}
                    style={{ display: loading ? 'none' : 'block' }}
                    className={
                      inlineFullscreen && width < 500
                        ? classes.inlineFullscreenVideo
                        : undefined
                    }
                    classNames={{ controls: classes.inlineFullscreenControls }}
                  >
                    <Video.Controls>
                      <Video.PlayButton />
                      {width >= 500 ||
                        (inlineFullscreen && width < 500 && (
                          <>
                            <Video.SkipButton seconds={-10} />
                            <Video.SkipButton seconds={10} />
                          </>
                        ))}
                      <Video.Timeline />
                      {width >= 500 && (
                        <Video.TimeDisplay format="current/-remaining" />
                      )}
                      <Video.MuteButton />
                      <Video.PiPButton />
                      {canFullscreen ? (
                        <Video.FullscreenButton />
                      ) : (
                        width < 500 && (
                          <ActionIcon
                            variant="subtle"
                            color="white"
                            aria-label={
                              inlineFullscreen
                                ? 'Exit fullscreen'
                                : 'Enter fullscreen'
                            }
                            onClick={() =>
                              setInlineFullscreen((value) => !value)
                            }
                          >
                            {inlineFullscreen ? (
                              <IconArrowsMinimize size={20} />
                            ) : (
                              <IconArrowsMaximize size={20} />
                            )}
                          </ActionIcon>
                        )
                      )}
                    </Video.Controls>
                  </Video>
                  {/* <Text
                    pos="absolute"
                    bottom={-50}
                    style={{ display: loading ? 'none' : 'block' }}
                  >
                    {`${recording.nickname ? `${recording.nickname} (` : ''}${formatTime(recording.duration)}${recording.nickname ? ')' : ''}`}
                  </Text> */}
                  <RecordingInfo recording={recording} loading={loading} />
                </div>
              </>
            )}
          </Center>
        ),
        renderThumb: () => (
          <Center
            pos="relative"
            h="100%"
            bg="blue.6"
            style={{ borderRadius: 4 }}
          >
            {signedUrlsMap.has(recording.streamId) &&
            signedUrlsMap.get(recording.streamId)!.has(recording.page) &&
            recording.index <
              signedUrlsMap.get(recording.streamId)!.get(recording.page)!
                .length ? (
              <>
                <span
                  className={classes.recordingDurationBadge}
                  style={{
                    position: 'absolute',
                    bottom: 0,
                    background: 'none',
                    boxShadow: 'none',
                    textShadow: '0 2px 8px rgba(0, 0, 0, 0.35)',
                  }}
                >
                  {formatTime(recording.duration)}
                </span>
                <Image
                  radius="md"
                  h="100%"
                  src={
                    signedUrlsMap.get(recording.streamId)!.get(recording.page)![
                      recording.index
                    ]!.url
                  }
                />
              </>
            ) : (
              <Text c="white" size="xs">
                {recording.filename}
              </Text>
            )}
          </Center>
        ),
      })),
    [canFullscreen, inlineFullscreen, props.currentPage, loading, width],
  )

  useEffect(() => {
    if (!lightboxOpen) setInlineFullscreen(false)
  }, [activeRecording, lightboxOpen])

  useEffect(() => {
    ;(async function getSignedUrls() {
      if (!props.activeStream || props.pageLoading) return

      const page = props.currentPage[0]?.page
      if (
        !Number.isInteger(page) ||
        props.currentPage.some(
          (recording) => recording.streamId !== props.activeStream!.id,
        )
      ) {
        return
      }

      const filenames = props.currentPage.map((recording) =>
        recording.filename.replace('.mp4', '.jpg'),
      )
      let streamSignedUrls = signedUrlsMap.get(props.activeStream.id)
      if (!streamSignedUrls) {
        streamSignedUrls = new Map()
        signedUrlsMap.set(props.activeStream.id, streamSignedUrls)
      }
      const cachedUrls = streamSignedUrls.get(page)
      const cacheIsFresh =
        cachedUrls?.length === filenames.length &&
        cachedUrls.every(
          (signedUrl, index) =>
            signedUrl?.filename === filenames[index] &&
            signedUrl.expiresAt - 10 >= Date.now() / 1000,
        )

      if (cacheIsFresh) return

      const requestKey = `${props.activeStream.id}:${page}:${filenames.join('\0')}`
      const pendingRequest = props.signedUrlRequests.get(requestKey)
      if (pendingRequest) {
        await pendingRequest
        return
      }

      const request = (async () => {
        const res = await authFetch(
          `${API_BASE}/api/signed-urls/${props.activeStream!.id}?filenames=${filenames.join(',')}&type=thumbnail`,
        )
        if (!res.ok) {
          setTimeout(() => getSignedUrls(), 1000) // Try again every second
          return console.error(
            'Failed to load recordings: ' + (await res.text()),
          )
        }
        const signedUrls = (await res.json()) as {
          filename: string
          url: string
          expiresAt: number
        }[]

        streamSignedUrls.set(
          page,
          signedUrls.map((signedUrl) => {
            if (!signedUrl.url || !signedUrl.expiresAt || !signedUrl.filename) {
              console.error(`Invalid URL signing output: ${signedUrl}`)
              return null
            }

            return {
              filename: signedUrl.filename,
              url: signedUrl.url,
              expiresAt: signedUrl.expiresAt,
            }
          }),
        )
      })()

      props.signedUrlRequests.set(requestKey, request)
      try {
        await request
      } finally {
        if (props.signedUrlRequests.get(requestKey) === request) {
          props.signedUrlRequests.delete(requestKey)
        }
      }
    })()
  }, [
    props.currentPage,
    props.pageLoading,
    props.signedUrlRequests,
    props.signedUrlsCache,
    props.activeStream,
  ])

  useEffect(() => {
    if (!lightboxOpen || !activeRecording) return

    if (!videoElement) return

    let cancelled = false
    let refreshTimer: number | undefined
    let onVideoLoad: (() => void) | undefined

    const loadRecording = async () => {
      if (!videoElement) return
      setLoading(true)
      const src = await fetchRecordingUrl(videoElement.src || undefined)
      if (cancelled || !src) {
        if (!cancelled) {
          setLoading(false)
          console.error('Failed to fetch recording source')
        }
        return
      }

      const expires = Number(URL.parse(src)?.searchParams.get('expires'))
      onVideoLoad = () => setLoading(false)
      videoElement.addEventListener('loadeddata', onVideoLoad)
      videoElement.src = src
      videoElement.load()

      if (Number.isFinite(expires)) {
        refreshTimer = window.setTimeout(
          () => loadRecording(),
          Math.max(0, expires * 1000 - Date.now() - 5_000),
        )
      }
    }

    loadRecording()

    return () => {
      cancelled = true
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
      if (videoElement) {
        if (onVideoLoad) {
          videoElement.removeEventListener('loadeddata', onVideoLoad)
        }
        videoElement.removeAttribute('src')
        videoElement.load()
      }
      setLoading(false)
    }
  }, [activeRecording, fetchRecordingUrl, lightboxOpen, videoElement])

  return (
    <SimpleGrid
      minColWidth="250px"
      autoRows="minmax(240px, auto)"
      type="container"
      pos={'relative'}
    >
      <LoadingOverlay
        visible={props.pageLoading}
        zIndex={1000}
        overlayProps={{ radius: 'sm', blur: 2 }}
      />
      <CollapsedLightbox
        opened={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        slides={lightboxSlides}
        currentIndex={currentLightboxIndex}
        onIndexChange={(index) => setRecording(props.currentPage[index])}
        withThumbnails
        withDownload
        onRecordingDeleted={() =>
          onRecordingDeleted(
            activeRecording!,
            props.recordings,
            setLoading,
            setRecording,
            setLightboxOpen,
          )
        }
        recordingsCount={props.recordingsCount}
        recordings={props.recordings}
        activeRecording={activeRecording}
        currentSrc={videoElement?.src || ''}
        closeOnSwipeDown={!(inlineFullscreen && width < 500)}
        withFullscreen={canFullscreen}
        closeOnClickOutside={false}
        emblaOptions={{ watchDrag: false }}
      />
      {props.currentPage?.map((recording, index) => (
        <Paper
          mt="sm"
          shadow="xs"
          withBorder
          p="xl"
          key={index}
          className={classes.recording}
          onClick={() => {
            setRecording(recording)
            setLightboxOpen(true)
          }}
        >
          <div className={classes.thumbnailFrame}>
            {signedUrlsMap.has(recording.streamId) &&
              signedUrlsMap.get(recording.streamId)!.has(recording.page) &&
              recording.index <
                signedUrlsMap.get(recording.streamId)!.get(recording.page)!
                  .length && (
                <Image
                  radius="md"
                  h="100%"
                  src={
                    signedUrlsMap.get(recording.streamId)!.get(recording.page)![
                      recording.index
                    ]!.url
                  }
                  onLoad={() => {
                    loadedThumbnailMap.set(
                      `${recording.streamId}-${recording.filename}`,
                      true,
                    )
                  }}
                />
              )}
            <span
              className={classes.recordingDurationBadge}
              style={{
                display: loadedThumbnailMap.has(
                  `${recording.streamId}-${recording.filename}`,
                )
                  ? loadedThumbnailMap.get(
                      `${recording.streamId}-${recording.filename}`,
                    )
                    ? 'block'
                    : 'none'
                  : 'none',
                color: 'white',
              }}
            >
              {formatTime(recording.duration)}
            </span>
          </div>
          <Text style={{ textAlign: 'center' }}>
            <Text span td="underline">
              {recording.nickname}
            </Text>
          </Text>
          <Text style={{ textAlign: 'center' }} c="gray.6">
            {formatTimestamp(recording.filename)}
          </Text>
        </Paper>
      ))}
    </SimpleGrid>
  )
}

function RecordingInfo(props: { recording: Recording; loading: boolean }) {
  const { width } = useViewportSize()

  return (
    width <= 600 &&
    !props.loading && (
      <Grid gap={0} mt="md">
        {props.recording.nickname ? (
          <Grid.Col span={'content'}>
            <Text span>{props.recording.nickname}&nbsp;&mdash;&nbsp;</Text>
          </Grid.Col>
        ) : null}
        <Grid.Col span={'content'}>
          <Text span>
            {formatTime(props.recording.duration)}&nbsp;&mdash;&nbsp;
          </Text>
        </Grid.Col>
        <Grid.Col span={'content'}>
          <Text span>{formatTimestamp(props.recording.filename)}</Text>
        </Grid.Col>
      </Grid>
    )
  )
}

export function formatTime(sec: number) {
  if (!isFinite(sec)) return '0:00'
  const m = Math.floor(sec / 60)
  const s = Math.floor(sec % 60)
  return `${m}m ${s.toString().padStart(2, '0')}s`
}

export function formatTimestamp(filename: string) {
  const match = filename.match(/motion_(.+)\.mp4/)
  if (!match) return filename
  const iso = match[1].replace(
    /T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z/,
    (_m, h, m2, s, ms) => `T${h}:${m2}:${s}.${ms}Z`,
  )
  const date = new Date(iso)
  return isNaN(date.getTime()) ? match[1] : date.toLocaleString()
}
