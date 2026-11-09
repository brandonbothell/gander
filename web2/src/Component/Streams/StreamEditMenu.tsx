import { FiPause, FiPlay, FiSettings, FiX } from 'react-icons/fi'
import { useCallback, useState } from 'react'
import { notifications } from '@mantine/notifications'
import { Group, Menu } from '@mantine/core'
import CreateEditStreamPopover from '../CreateStream/CreateEditStreamPopover'
import { Stream } from '../../types'
import { API_BASE, authFetch } from '../../main'

export default function StreamEditMenu(props: {
  ref?: React.Ref<HTMLDivElement>
  children: React.ReactNode
  streams: Map<string, Stream>
  setLayouts: (
    val:
      | {
          id: number
          splitterStreams: string[]
        }[]
      | ((
          prevState: {
            id: number
            splitterStreams: string[]
          }[],
        ) => {
          id: number
          splitterStreams: string[]
        }[]),
  ) => void
  stream: Stream
  motionStatus: {
    detectingMotion: boolean
    recording: boolean
    secondsLeft: number
    saving: boolean
    startedRecordingAt: number
    lowDiskSpace: boolean
  }
  setMotionStatus: React.Dispatch<
    React.SetStateAction<{
      [streamId: string]: {
        detectingMotion: boolean
        recording: boolean
        secondsLeft: number
        saving: boolean
        startedRecordingAt: number
        lowDiskSpace: boolean
      }
    }>
  >
  setStream(streamId: string): void | Promise<void>
}) {
  const [popoverOpen, setPopoverOpen] = useState(false)
  const [togglingDetection, setTogglingDetection] = useState(false)

  const toggleDetection = useCallback(() => {
    const motionPaused = props.motionStatus?.detectingMotion
    setTogglingDetection(true)
    authFetch(`${API_BASE}/api/motion-pause/${props.stream.id}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ paused: motionPaused }),
    })
      .then((r) => r.json())
      .then((status: { paused: boolean }) =>
        props.setMotionStatus((prev) => {
          prev[props.stream.id] = {
            ...prev[props.stream.id],
            detectingMotion: !status.paused,
          }
          return { ...prev }
        }),
      )
      .catch((err) => {
        console.error('Error toggling motion detection:', err)
        notifications.show({
          message: 'Failed to toggle motion detection. Please try again.',
          color: 'red',
        })
      })
      .finally(() => setTogglingDetection(false))
  }, [props.motionStatus?.detectingMotion])

  return (
    <Group wrap="nowrap" gap={0}>
      <Menu
        transitionProps={{ transition: 'pop' }}
        position="bottom-end"
        closeOnItemClick={false}
        closeOnClickOutside={!popoverOpen}
        hideDetached={!popoverOpen}
        styles={{
          dropdown: {
            zIndex: 1003,
          },
        }}
        menuItemTabIndex={0}
      >
        <Menu.Target>{props.children}</Menu.Target>
        <Menu.Dropdown ref={props.ref}>
          <Menu.Label>Camera</Menu.Label>
          <Menu.Item
            color={props.motionStatus?.detectingMotion ? 'yellow' : 'green'}
            disabled={!props.motionStatus || togglingDetection}
            onClick={toggleDetection}
            leftSection={
              props.motionStatus?.detectingMotion ? (
                <FiPause size={14} />
              ) : (
                <FiPlay size={14} />
              )
            }
          >
            {props.motionStatus?.detectingMotion ? 'Pause' : 'Start'} Detection
          </Menu.Item>
          <CreateEditStreamPopover
            setLayouts={props.setLayouts}
            setStream={props.setStream}
            streams={props.streams}
            currentStream={props.stream}
            setOpen={setPopoverOpen}
          >
            <Menu.Item leftSection={<FiSettings size={14} />}>
              Settings
            </Menu.Item>
          </CreateEditStreamPopover>

          <Menu.Divider />

          <Menu.Label>Layout</Menu.Label>
          <Menu.Item
            color="red"
            onClick={() => props.setStream('')}
            leftSection={<FiX size={16} />}
          >
            Remove
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  )
}
