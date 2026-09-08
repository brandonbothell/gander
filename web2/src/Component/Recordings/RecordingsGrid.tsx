import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Lightbox, type LightboxSlideData } from '@mantine/lightbox'
import { useDisclosure, useMap } from '@mantine/hooks'
import {
  Paper,
  SimpleGrid,
  Text,
  Image,
  LoadingOverlay,
  Center,
} from '@mantine/core'
import { Video } from '@gfazioli/mantine-video'
import { Recording } from '../../types'
import { API_BASE, authFetch, fetchWithRetry } from '../../main'
import classes from './RecordingsGrid.module.css'

export default function RecordingsGrid(props: {
  recordings: Recording[]
  pageLoading: boolean
}) {
  const signedUrlsMap = useMap<string, { url: string; expiresAt: number }>()
  const loadedThumbnailMap = useMap<string, boolean>()

  const [loading, setLoading] = useState(false)
  const [activeRecording, setRecording] = useState<Recording | null>(null)
  const videoRef = useRef<HTMLDivElement>(null)
  const [videoElement, setVideoElement] = useState<HTMLVideoElement | null>(
    null,
  )
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
      const url = `${API_BASE}/api/signed-urls/${activeRecording.streamId}?type=video&filenames=${activeRecording.filename}`

      try {
        const response = await fetchWithRetry(() => authFetch(url))
        const signedUrl = `${API_BASE}${(await response.json())[0].url}`

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
      props.recordings.findIndex((recording) => {
        if (activeRecording) {
          return (
            recording.filename === activeRecording.filename &&
            recording.streamId === activeRecording.streamId
          )
        }
      }),
    [props.recordings, activeRecording],
  )
  const [lightboxOpen, { set: setLightboxOpen }] = useDisclosure(false)
  const lightboxSlides = useMemo<LightboxSlideData[]>(
    () =>
      props.recordings.map((recording) => ({
        type: 'custom',
        autoPlay: true,
        render: ({ active }) =>
          active && (
            <Center h="100%">
              <LoadingOverlay
                visible={loading}
                zIndex={2000}
                overlayProps={{ radius: 'sm', blur: 2 }}
              />
              <Video autoPlay muted shortcuts ref={setVideoContainer} h="80%">
                <Video.Controls />
              </Video>
            </Center>
          ),
        renderThumb: () => (
          <Center h="100%" bg="blue.6" style={{ borderRadius: 4 }}>
            {signedUrlsMap.has(
              `${recording.streamId}-${recording.filename}`,
            ) ? (
              <Image
                radius="md"
                h="100%"
                src={
                  signedUrlsMap.get(
                    `${recording.streamId}-${recording.filename}`,
                  )!.url
                }
              />
            ) : (
              <Text c="white" size="xs">
                {recording.filename}
              </Text>
            )}
          </Center>
        ),
      })),
    [props.recordings, loading],
  )

  useEffect(() => {
    props.recordings.forEach(async function getSignedUrl(recording) {
      if (
        !signedUrlsMap.has(`${recording.streamId}-${recording.filename}`) ||
        signedUrlsMap.get(`${recording.streamId}-${recording.filename}`)!
          .expiresAt -
          10 <
          Date.now() / 1000
      ) {
        const res = await authFetch(
          `${API_BASE}/api/signed-url/${recording.streamId}?filename=${recording.filename.replace('.mp4', '.jpg')}&type=thumbnail`,
        )
        if (!res.ok) {
          setTimeout(() => getSignedUrl(recording), 1000) // Try again every second
          return console.error(
            'Failed to load recordings: ' + (await res.text()),
          )
        }
        const signedUrl = (await res.json()) as {
          filename: string
          url: string
          expiresAt: number
        }
        if (!signedUrl.url || !signedUrl.expiresAt || !signedUrl.filename) {
          return console.error(`Invalid URL signing output: ${signedUrl}`)
        }

        signedUrlsMap.set(`${recording.streamId}-${recording.filename}`, {
          url: signedUrl.url,
          expiresAt: signedUrl.expiresAt,
        })

        return signedUrl
      }
    })
  }, [props.recordings, signedUrlsMap])

  useEffect(() => {
    if (!lightboxOpen || !activeRecording) return

    if (!videoElement) return

    let cancelled = false
    let refreshTimer: number | undefined
    let onVideoLoad: (() => void) | undefined

    const loadRecording = async () => {
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
          () => void loadRecording(),
          Math.max(0, expires * 1000 - Date.now() - 5_000),
        )
      }
    }

    void loadRecording()

    return () => {
      cancelled = true
      if (refreshTimer !== undefined) window.clearTimeout(refreshTimer)
      if (onVideoLoad) {
        videoElement.removeEventListener('loadeddata', onVideoLoad)
      }
      videoElement.removeAttribute('src')
      videoElement.load()
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
      <Lightbox
        opened={lightboxOpen}
        onClose={() => setLightboxOpen(false)}
        slides={lightboxSlides}
        currentIndex={currentLightboxIndex}
        onIndexChange={(index) => setRecording(props.recordings[index])}
        withThumbnails
        withDownload
        withFullscreen
      />
      {props.recordings?.map((recording, index) => (
        <Paper
          mt="sm"
          shadow="xs"
          withBorder
          p="xl"
          key={index}
          onClick={() => {
            setRecording(recording)
            setLightboxOpen(true)
          }}
        >
          <div className={classes.thumbnailFrame}>
            {signedUrlsMap.has(
              `${recording.streamId}-${recording.filename}`,
            ) && (
              <Image
                radius="md"
                h="100%"
                src={
                  signedUrlsMap.get(
                    `${recording.streamId}-${recording.filename}`,
                  )!.url
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

function formatTime(sec: number) {
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
