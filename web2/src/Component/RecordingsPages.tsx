import { useCallback, useEffect, useState } from 'react'
import { randomId, useMap } from '@mantine/hooks'
import {
  Box,
  Code,
  Combobox,
  Input,
  InputBase,
  LoadingOverlay,
  Pagination,
  Title,
  useCombobox,
} from '@mantine/core'
import { Recording } from '../types'
import { API_BASE, authFetch } from '../main'
import { type Stream } from '../../../source/types/shared'

function chunk<T>(array: T[], size: number): T[][] {
  if (!array.length) {
    return []
  }
  const head = array.slice(0, size)
  const tail = array.slice(size)
  return [head, ...chunk(tail, size)]
}

const data = chunk(
  Array(30)
    .fill(0)
    .map((_, index) => ({ id: index, name: randomId() })),
  5,
)

export default function RecordingsPages(props: { streams: Stream[] }) {
  const [loading, setLoading] = useState(false)

  const totalRecordings = useMap<string, number>()
  const recordings = useMap<string, Recording[][]>()
  const [activePage, setPage] = useState(1)
  const [lastFailedPage, setLastFailedPage] = useState(0)
  const [activeStream, setStream] = useState<Stream | null>(null)

  const streamCombobox = useCombobox({
    onDropdownClose: () => streamCombobox.resetSelectedOption(),
  })
  const streamComboboxOptions = props.streams.map((stream, index) => (
    <Combobox.Option value={index} key={index}>
      <Code
        style={{ fontSize: '1em' }}
        color={activeStream?.id === stream.id ? 'blue.9' : undefined}
      >
        {stream.nickname}
      </Code>
    </Combobox.Option>
  ))

  const getItems = useCallback(() => {
    if (!activeStream) return <>Select a stream to view recordings.</>

    const streamRecordings = recordings.get(activeStream.id)
    const activePageRecordings = streamRecordings?.[activePage - 1]
    const recordingsToRender = activePageRecordings?.length
      ? activePageRecordings
      : streamRecordings?.find((page) => page.length > 0)

    if (!recordingsToRender) {
      return <>Failed to load page.</>
    }

    return recordingsToRender.map((recording) => (
      <Code key={recording.filename} mt="sm">
        filename: {recording.filename}, duration: {recording.duration}s
      </Code>
    ))
  }, [activePage, activeStream, recordings])

  useEffect(() => {
    if (lastFailedPage !== 0 && activePage === lastFailedPage) return
    if (!activeStream && props.streams.length) setStream(props.streams[0])
    ;(async () => {
      console.log(`Active stream: ${activeStream?.id}`)
      if (activeStream) {
        const currentRecordings = recordings.get(activeStream.id)
        if (currentRecordings && currentRecordings.length >= activePage) {
          const currentPage = currentRecordings[activePage - 1]
          // The page is already cached
          if (currentPage.length !== 0) return
        }

        setLoading(true)
        const res = await authFetch(
          `${API_BASE}/api/recordings/${activeStream.id}/${activePage}`,
        )
        if (!res.ok) {
          console.error(`Error loading recordings: ${await res.text()}`)
          setLastFailedPage(activePage)
          setLoading(false)
          return
        }

        setLastFailedPage(0)

        const page = (await res.json()) as {
          total: number
          recordings: {
            streamId: string
            filename: string
            motionTimestamps: string
            duration: number
          }[]
          deletedRecordings: string[]
        }

        if (!page.total || !page.recordings?.length) {
          console.error(`Error loading recordings: ${JSON.stringify(page)}`)
          setLastFailedPage(activePage)
          totalRecordings.set(activeStream.id, page.total || 0)
          setLoading(false)
          return
        }

        const newRecordings: Recording[] = page.recordings.map((rec) => ({
          filename: rec.filename,
          motionTimestamps: JSON.parse(rec.motionTimestamps),
          streamId: rec.streamId,
          duration: rec.duration,
        }))

        totalRecordings.set(activeStream.id, page.total)

        // Set first page and initialize the rest as empty if we just started
        if (!currentRecordings) {
          recordings.set(activeStream.id, [
            newRecordings,
            ...(() => {
              const blankPages: [][] = []

              // 50 items per page
              for (let i = 0; i < Math.ceil(page.total / 50); i++) {
                blankPages.push([])
              }

              return blankPages
            })(),
          ])
        } else {
          // Create empty pages first
          if (currentRecordings.length < activePage) {
            recordings.set(activeStream.id, [
              ...currentRecordings,
              ...(() => {
                const blankPages: [][] = []

                // 50 items per page
                for (let i = 0; i < Math.ceil(page.total / 50); i++) {
                  blankPages.push([])
                }

                return blankPages
              })(),
            ])
          }

          currentRecordings[activePage - 1] = newRecordings
          recordings.set(activeStream.id, currentRecordings)
        }

        setLoading(false)
      }
    })()
  }, [props.streams, activeStream, recordings, activePage])

  return (
    <>
      {activeStream && (
        <Combobox
          store={streamCombobox}
          onOptionSubmit={(val) => {
            const stream = props.streams[Number(val)]
            setPage(1)
            setStream(stream)
            streamCombobox.closeDropdown()
          }}
        >
          <Combobox.Target>
            <InputBase
              component="button"
              type="button"
              pointer
              rightSection={<Combobox.Chevron />}
              rightSectionPointerEvents="none"
              onClick={() => streamCombobox.toggleDropdown()}
              size="md"
            >
              <Title order={2}>
                {activeStream ? (
                  <>
                    <Code color="blue.9" style={{ fontSize: '1em' }}>
                      {activeStream.nickname}
                    </Code>{' '}
                    recordings
                  </>
                ) : (
                  <Input.Placeholder>Loading recordings...</Input.Placeholder>
                )}
              </Title>
            </InputBase>
          </Combobox.Target>

          <Combobox.Dropdown>
            <Combobox.Options>{streamComboboxOptions}</Combobox.Options>
          </Combobox.Dropdown>
        </Combobox>
      )}
      {activeStream && (
        <Box pos="relative">
          <Pagination
            total={
              totalRecordings.has(activeStream.id)
                ? Math.ceil(totalRecordings.get(activeStream.id)! / 50)
                : 0
            }
            value={activePage}
            onChange={setPage}
            mt="sm"
          />
          <LoadingOverlay
            visible={loading}
            zIndex={1000}
            overlayProps={{ radius: 'sm', blur: 2 }}
          />
        </Box>
      )}
      {activeStream && getItems()}
    </>
  )
}
