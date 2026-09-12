/* eslint-disable import/no-named-as-default-member */
import { FiChevronDown } from 'react-icons/fi'
import { useCallback, useEffect, useRef, useState } from 'react'
// eslint-disable-next-line import/no-named-as-default
import Hls from 'hls.js'
import { useHover, useViewportSize } from '@mantine/hooks'
import { ActionIcon, LoadingOverlay } from '@mantine/core'
import { Video } from '@gfazioli/mantine-video'
import { type Stream } from '../../types'
import { API_BASE, fetchWithRetry, authFetch } from '../../main'
import StreamEditMenu from './StreamEditMenu'

export default function StreamVideo(props: {
  streams: Map<string, Stream>
  stream: Stream
  getAspectRatio: () => string
  removeFromLayout: () => void | Promise<void>
}) {
  const [streamUrl, setStreamUrl] = useState<string>()
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const videoRef = useRef<HTMLDivElement>(null)
  const { hovered: videoHovered, ref: videoHoveredRef } =
    useHover<HTMLDivElement>()
  const { hovered: popoverHovered, ref: popoverHoveredRef } =
    useHover<HTMLDivElement>()
  const streamRequestId = useRef(0)
  const { width } = useViewportSize()

  const fetchStreamUrl = useCallback(
    async (currentUrl?: string, force = false) => {
      const parsedUrl = currentUrl ? URL.parse(currentUrl) : null
      const expires = Number(parsedUrl?.searchParams.get('expires'))
      const isFresh =
        parsedUrl &&
        Number.isFinite(expires) &&
        expires * 1000 - 5_000 >= Date.now()

      if (!force && isFresh) return

      const requestId = ++streamRequestId.current
      const url = `${API_BASE}/api/signed-stream-url/${props.stream.id}`

      try {
        const response = await fetchWithRetry(() => authFetch(url))
        const signedUrl = `${API_BASE}${(await response.json()).url}`

        if (requestId !== streamRequestId.current) return
        setError(null)
        setStreamUrl(signedUrl)
      } catch {
        if (requestId !== streamRequestId.current) return
        console.error('Failed to fetch signed stream URL')
        setError('Failed to load the stream. Please try again later.')
      }
    },
    [props.stream.id],
  )

  useEffect(() => {
    streamRequestId.current++
    setStreamUrl(undefined)
    fetchStreamUrl()
  }, [props.stream.id])

  useEffect(() => {
    if (!streamUrl) return

    const expires = Number(URL.parse(streamUrl)?.searchParams.get('expires'))
    if (!Number.isFinite(expires)) return

    const refreshTimer = window.setTimeout(
      () => fetchStreamUrl(streamUrl, true),
      Math.max(0, expires * 1000 - Date.now() - 5_000),
    )

    return () => window.clearTimeout(refreshTimer)
  }, [streamUrl, fetchStreamUrl])

  const loadStream = useCallback(() => {
    const video = videoRef.current
    if (!video || !streamUrl) return

    const videoElement = video.getElementsByTagName('video')[0]
    if (!videoElement) {
      setError('Video player is not available.')
      return
    }

    setLoading(true)
    let seekTimeout: number

    if (Hls.isSupported()) {
      const hls = new Hls({
        liveSyncDuration: 1,
      })
      hls.loadSource(streamUrl)
      hls.attachMedia(videoElement)

      seekTimeout = setTimeout(() => {
        if (hls.liveSyncPosition !== null) {
          const targetTime = hls.liveSyncPosition
          console.log(`Setting current time to ${targetTime}`)
          videoElement.currentTime = Math.max(
            targetTime,
            videoElement.currentTime,
          )
        }
      }, 5000)

      hls.on(Hls.Events.ERROR, (_event, data) => {
        console.log('HLS error:', data.type, data.details, data)

        // Check for 403 Forbidden on fragment/network errors
        if (
          data.type === Hls.ErrorTypes.NETWORK_ERROR &&
          data.response &&
          data.response.code === 403
        ) {
          console.warn('HLS 403 Forbidden')
          fetchStreamUrl(streamUrl, true)
          return
        }
      })

      setLoading(false)
      return () => hls.destroy()
    } else if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
      videoElement.src = streamUrl
      setError(null)
    } else {
      setError('This browser does not support video streaming.')
    }

    setLoading(false)
    return () => {
      videoElement.removeAttribute('src')
      videoElement.load()
      clearTimeout(seekTimeout)
    }
  }, [videoRef, streamUrl])

  useEffect(() => {
    if (streamUrl) return loadStream()
  }, [streamUrl, loadStream])

  return (
    <>
      {error && (
        <div role="alert" style={{ marginBottom: 8 }}>
          {error}
        </div>
      )}
      <LoadingOverlay
        visible={loading}
        style={{ aspectRatio: props.getAspectRatio() }}
        w={width < 768 ? '95dvw' : undefined}
        h={width < 768 ? undefined : '70dvh'}
        zIndex={1000}
        overlayProps={{ radius: 'sm', blur: 2 }}
      />
      <Video
        w={'100%'}
        autoPlay
        muted
        clickToToggle={false}
        doubleClickToFullscreen
        ref={(ref) => {
          videoRef.current = ref
          videoHoveredRef(ref)
        }}
      >
        <div
          style={{
            position: 'absolute',
            top: 8,
            left: 8,
            color: 'white',
            height: 20,
            marginTop: 4,
            textShadow: '0 1px 2px black',
            pointerEvents: 'none',
            display: 'flex',
            alignItems: 'end',
          }}
        >
          {props.stream.nickname}
          {(videoHovered || popoverHovered) && !document.fullscreenElement && (
            <StreamEditMenu ref={popoverHoveredRef} streams={props.streams}>
              <ActionIcon
                variant="light"
                ml={'sm'}
                color="white"
                radius="md"
                aria-label="Stream options"
                style={{
                  pointerEvents: 'auto',
                }}
              >
                <FiChevronDown size={16} />
              </ActionIcon>
            </StreamEditMenu>
          )}
          {/* <ActionIcon
              onClick={(event) => {
                event.preventDefault()
                props.removeFromLayout()
              }}
              variant="light"
              ml={'sm'}
              color="white"
              radius="md"
              aria-label="Remove stream from layout"
              style={{
                pointerEvents: 'auto',
              }}
            >
              <FiTrash size={16} />
            </ActionIcon> */}
        </div>
        <Video.Controls />
      </Video>
    </>
  )
}
