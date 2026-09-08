import { useEffect } from 'react'
import { useMap } from '@mantine/hooks'
import { Paper, SimpleGrid, Text, Image, LoadingOverlay } from '@mantine/core'
import { Recording } from '../../types'
import { API_BASE, authFetch } from '../../main'

export default function RecordingsGrid(props: {
  recordings: Recording[]
  pageLoading: boolean
}) {
  const signedUrlsMap = useMap<string, { url: string; expiresAt: number }>()

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
      {props.recordings?.map((recording) => (
        <Paper mt="sm" shadow="xs" withBorder p="xl">
          {signedUrlsMap.has(`${recording.streamId}-${recording.filename}`) && (
            <Image
              mb="sm"
              radius="md"
              src={
                signedUrlsMap.get(
                  `${recording.streamId}-${recording.filename}`,
                )!.url
              }
            />
          )}
          <Text style={{ textAlign: 'center' }}>
            {recording.filename} ({recording.duration}s)
          </Text>
        </Paper>
      ))}
    </SimpleGrid>
  )
}
