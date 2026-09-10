import { useCallback, useEffect, useState } from 'react'
import { useLocalStorage, useMap } from '@mantine/hooks'
import {
  Box,
  Code,
  Combobox,
  Input,
  InputBase,
  Pagination,
  Title,
  useCombobox,
  useMantineColorScheme,
  Text,
  useMantineTheme,
} from '@mantine/core'
import { Recording, type Stream } from '../../types'
import { API_BASE, authFetch } from '../../main'
import RecordingsGrid, { SignedThumbnailUrl } from './RecordingsGrid'

export default function RecordingsPages(props: { streams: Stream[] }) {
  const [loading, setLoading] = useState(false)
  const { colorScheme } = useMantineColorScheme()
  const { colors } = useMantineTheme()

  const totalRecordings = useMap<string, number>()
  const signedUrlsCache = useMap<
    string,
    // eslint-disable-next-line func-call-spacing
    Map<number, (SignedThumbnailUrl | null)[]>
  >()
  const signedUrlRequests = useMap<string, Promise<void>>()

  const recordings = useMap<
    // eslint-disable-next-line func-call-spacing
    string,
    (Recording & { page: number; index: number })[][]
  >()
  const [activePage, setPage] = useState(1)
  const [lastFailedPage, setLastFailedPage] = useState(0)
  const [activeStream, setStream] = useState<Stream | null>(null)
  const [selectedStream, saveSelectedStream] = useLocalStorage({
    key: 'activeStream',
  })

  const streamCombobox = useCombobox({
    onDropdownClose: () => streamCombobox.resetSelectedOption(),
  })
  const streamComboboxOptions = props.streams.map((stream, index) => (
    <Combobox.Option value={index} key={index}>
      <Code
        style={{ fontSize: '1em' }}
        color={
          activeStream?.id === stream.id
            ? colorScheme === 'light'
              ? 'blue.6'
              : 'blue.9'
            : undefined
        }
      >
        <Text
          span
          size="1em"
          style={{
            color:
              colorScheme === 'light' && stream.id === activeStream?.id
                ? colors.gray[0]
                : undefined,
          }}
        >
          {stream.nickname}
        </Text>
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

    return (
      <RecordingsGrid
        recordings={recordings}
        recordingsCount={totalRecordings}
        currentPage={recordingsToRender}
        pageLoading={loading}
        activeStream={activeStream}
        signedUrlsCache={signedUrlsCache}
        signedUrlRequests={signedUrlRequests}
      />
    )
  }, [activePage, activeStream, recordings, loading])

  useEffect(() => {
    if (lastFailedPage !== 0 && activePage === lastFailedPage) return
    if (!activeStream && props.streams.length) {
      let stream = selectedStream
        ? (props.streams.find((s) => s.id === selectedStream) ??
          props.streams[0])
        : props.streams[0]
      setStream(stream)
      saveSelectedStream(stream.id)
    }
    ;(async () => {
      if (activeStream) {
        const currentRecordings = recordings.get(activeStream.id)
        if (currentRecordings && currentRecordings.length >= activePage) {
          const currentPage = currentRecordings[activePage - 1]
          // The page is already cached
          if (currentPage.length !== 0) return
        }

        console.log(
          `Fetching page ${activePage} of stream: ${activeStream?.id} (${activeStream.nickname})`,
        )
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
          recordings: (Recording & { motionTimestamps: string })[]
          deletedRecordings: string[]
        }

        if (!page.total || !page.recordings?.length) {
          console.error(`Error loading recordings: ${JSON.stringify(page)}`)
          setLastFailedPage(activePage)
          totalRecordings.set(activeStream.id, page.total || 0)
          setLoading(false)
          return
        }

        const newRecordings = page.recordings.map((rec, index) => ({
          ...rec,
          motionTimestamps: JSON.parse(rec.motionTimestamps) as number[],
          page: activePage,
          index,
        }))

        totalRecordings.set(activeStream.id, page.total)

        // Set first page and initialize the rest as empty if we just started
        if (!currentRecordings) {
          recordings.set(activeStream.id, [
            newRecordings,
            ...(() => {
              const blankPages: [][] = []

              // 20 items per page
              for (let i = 0; i < Math.ceil(page.total / 20); i++) {
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

                for (let i = currentRecordings.length; i < activePage; i++) {
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
            saveSelectedStream(stream.id)
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
              styles={{
                input: {
                  height: 'auto',
                  minHeight: 'var(--input-height-md)',
                  whiteSpace: 'normal',
                  textAlign: 'left',
                },
              }}
            >
              <Title order={2}>
                {activeStream ? (
                  <>
                    <Code
                      color={colorScheme === 'light' ? 'blue.6' : 'blue.9'}
                      style={{ fontSize: '1em' }}
                    >
                      <Text
                        span
                        size="1em"
                        style={{
                          color:
                            colorScheme === 'light'
                              ? colors.gray[0]
                              : colors.gray[4],
                        }}
                      >
                        {activeStream.nickname}
                      </Text>
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
                ? Math.ceil(totalRecordings.get(activeStream.id)! / 20)
                : 0
            }
            value={activePage}
            onChange={setPage}
            mt="sm"
          />
        </Box>
      )}
      {activeStream && getItems()}
      {activeStream && (
        <Box pos="relative">
          <Pagination
            total={
              totalRecordings.has(activeStream.id)
                ? Math.ceil(totalRecordings.get(activeStream.id)! / 20)
                : 0
            }
            value={activePage}
            onChange={setPage}
            mt="sm"
          />
        </Box>
      )}
    </>
  )
}
