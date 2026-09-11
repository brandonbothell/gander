import { FiEdit } from 'react-icons/fi'
import { useCallback, useEffect, useState } from 'react'
import { useViewportSize } from '@mantine/hooks'
import {
  Button,
  Group,
  type MantineStyleProp,
  Popover,
  Stack,
  Text,
  TextInput,
} from '@mantine/core'
import { Recording } from '../../types'
import { authFetch, API_BASE } from '../../main'
import { formatTime, formatTimestamp } from './RecordingsGrid'

export default function RecordingRenamePopover(props: {
  recordings: Map<string, (Recording & { page: number; index: number })[][]>
  recording: Recording & { page: number; index: number }
  onNicknameChange?: (
    recording: Recording & { page: number; index: number },
    nickname: string,
  ) => void
  styles?: { button: MantineStyleProp }
}) {
  const [nickname, setNickname] = useState(props.recording.nickname || '')
  const [nicknameInputValue, setNicknameInputValue] = useState(
    props.recording.nickname || '',
  )
  const { width } = useViewportSize()

  useEffect(() => {
    setNickname(props.recording.nickname || '')
    setNicknameInputValue(props.recording.nickname || '')
  }, [props.recording])

  const saveNickname = useCallback(async () => {
    const oldNickname = nickname
    setNickname(nicknameInputValue)
    authFetch(
      `${API_BASE}/api/recordings/${props.recording.streamId}/${encodeURIComponent(props.recording.filename)}/nickname`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ nickname: nicknameInputValue }),
      },
    ).then((res) => {
      if (!res.ok) {
        console.error('Failed to save nickname:', res.statusText)
        return setNickname(oldNickname) // Reset on error
      }

      props.recording.nickname = nicknameInputValue
      const streamRecordings = props.recordings.get(props.recording.streamId)!
      streamRecordings[props.recording.page - 1][props.recording.index] =
        props.recording
      props.recordings.set(props.recording.streamId, streamRecordings)
    })

    props.onNicknameChange?.(props.recording, nicknameInputValue.trim())
  }, [nicknameInputValue])

  const cancelNicknameChange = () => {
    setNicknameInputValue(props.recording.nickname)
  }

  return (
    <Popover
      width={320}
      shadow="md"
      withArrow
      withOverlay
      overlayProps={{ zIndex: 10000, blur: '8px' }}
      zIndex={10001}
    >
      <Popover.Target>
        <Button
          variant="outline"
          color="white"
          rightSection={<FiEdit size={18} />}
          pr={12}
          radius="md"
          style={props.styles?.button}
        >
          {width > 600 ? 'Edit nickname' : 'Edit'}
        </Button>
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="sm">
          <Text fw={600}>Recording details</Text>
          <Text size="sm">
            <Text span fw={500}>
              Date and time:{' '}
            </Text>
            {formatTimestamp(props.recording.filename)}
          </Text>
          <Text size="sm">
            <Text span fw={500}>
              Duration:{' '}
            </Text>
            {formatTime(props.recording.duration)}
          </Text>
          <TextInput
            label="Nickname"
            value={nicknameInputValue}
            onChange={(event) =>
              setNicknameInputValue(event.currentTarget.value)
            }
          />
          <Group justify="flex-end" gap="xs">
            {nicknameInputValue !== nickname && (
              <>
                <Button variant="default" onClick={cancelNicknameChange}>
                  Cancel
                </Button>
                <Button onClick={() => void saveNickname()}>Save</Button>
              </>
            )}
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}
