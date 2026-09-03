import { useEffect, useRef, useState } from 'react'
import HLS from 'hls.js'
import { Video } from '@gfazioli/mantine-video'
import { API_BASE, fetchWithRetry, authFetch } from '../main'

export default function StreamVideo(props: { streamId: string }) {
  const [streamUrl, setStreamUrl] = useState<string>()
  const videoRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    ;(async () => {
      let url = `${API_BASE}/api/signed-stream-url/${props.streamId}`

      // Fetch signed URL from API
      try {
        const response = await fetchWithRetry(() => authFetch(url))
        url = `${API_BASE}${(await response.json()).url}`
      } catch {
        console.error('Failed to fetch signed stream URL')
        return
      }

      setStreamUrl(url)
    })()
  }, [props.streamId])

  useEffect(() => {
    const video = videoRef.current
    if (!video || !streamUrl) return

    const videoElement = video.getElementsByTagName('video')[0]

    // eslint-disable-next-line import/no-named-as-default-member
    if (HLS.isSupported()) {
      const hls = new HLS()
      hls.loadSource(streamUrl)
      hls.attachMedia(videoElement)

      return () => hls.destroy()
    }

    if (videoElement.canPlayType('application/vnd.apple.mpegurl')) {
      videoElement.src = streamUrl
    }

    return () => {
      videoElement.removeAttribute('src')
      videoElement.load()
    }
  }, [streamUrl])

  return <Video autoPlay muted clickToToggle={false} ref={videoRef} />
}
