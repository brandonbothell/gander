import { Recording } from './types'
import { authFetch, API_BASE } from './main'

export function onRecordingDeleted(
  recording: Recording & {
    page: number
    index: number
  },
  recordings: Map<string, (Recording & { page: number; index: number })[][]>,
  setLoading: React.Dispatch<React.SetStateAction<boolean>>,
  setRecording: React.Dispatch<
    React.SetStateAction<
      | (Recording & {
          page: number
          index: number
        })
      | null
    >
  >,
  setLightboxOpen: (value: boolean) => void,
) {
  setTimeout(async () => {
    setLoading(true)
    // Refresh the current page and delete cache of future pages
    if (recording) {
      const streamRecordings = recordings.get(recording.streamId)!
      const res = await authFetch(
        `${API_BASE}/api/recordings/${recording.streamId}/${recording.page}`,
      )
      if (!res.ok) {
        console.error(`Error loading recordings: ${await res.text()}`)
        setLoading(false)
        return
      }
      const page = (await res.json()) as {
        total: number
        recordings: (Recording & { motionTimestamps: string })[]
        deletedRecordings: string[]
      }
      if (!page.total || !page.recordings?.length) {
        console.error('Error loading recordings', page)
        setLoading(false)
        return
      }
      const newRecordings = page.recordings.map((rec, index) => ({
        ...rec,
        motionTimestamps: JSON.parse(rec.motionTimestamps) as number[],
        page: recording.page,
        index,
      }))
      streamRecordings[recording.page - 1] = newRecordings
      for (let i = recording.page; i < streamRecordings.length; i++) {
        streamRecordings[i] = []
      }
      recordings.set(recording.streamId, streamRecordings)
    }
    const streamRecordings = recording
      ? recordings.get(recording.streamId)
      : null
    if (
      recording &&
      recording.index < streamRecordings![recording.page - 1].length
    ) {
      setRecording(streamRecordings![recording.page - 1][recording.index])
    } else if (
      recording &&
      recording.index - 1 < streamRecordings![recording.page - 1].length
    ) {
      setRecording(streamRecordings![recording.page - 1][recording.index - 1])
    } else {
      console.warn('Next recording not found', recording)
      console.log(
        `Current page length: ${recording ? streamRecordings![recording.page - 1].length : 'No active recording!'}`,
      )
      setLightboxOpen(false)
    }

    setLoading(false)
  }, 500) // Give time for the recordings to shift pages
}
