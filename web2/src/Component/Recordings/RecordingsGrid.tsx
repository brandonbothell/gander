import { useEffect } from 'react'
import { useMap } from '@mantine/hooks'
import { Paper, SimpleGrid, Text, Image, LoadingOverlay } from '@mantine/core'
import { Recording } from '../../types'
import { API_BASE, authFetch } from '../../main'
import classes from './RecordingsGrid.module.css'

export default function RecordingsGrid(props: {
  recordings: Recording[]
  pageLoading: boolean
}) {
  const signedUrlsMap = useMap<string, { url: string; expiresAt: number }>()
  const loadedThumbnailMap = useMap<string, boolean>()

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
      {props.recordings?.map((recording, index) => (
        <Paper mt="sm" shadow="xs" withBorder p="xl" key={index}>
          {signedUrlsMap.has(`${recording.streamId}-${recording.filename}`) && (
            <div style={{ position: 'relative' }}>
              <Image
                mb="sm"
                radius="md"
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
          )}
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
