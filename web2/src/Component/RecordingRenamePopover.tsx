import { FiEdit } from 'react-icons/fi'
import { useEffect, useState } from 'react'
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
import { Recording } from '../types'
import { formatTime, formatTimestamp } from './Recordings/RecordingsGrid'

export default function RecordingRenamePopover(props: {
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

  const saveNickname = () => {
    setNickname(nicknameInputValue)
    props.onNicknameChange?.(props.recording, nicknameInputValue.trim())
  }

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
                <Button onClick={saveNickname}>Save</Button>
              </>
            )}
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}
