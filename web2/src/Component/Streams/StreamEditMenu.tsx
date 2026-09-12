import { FiSettings, FiTrash, FiX } from 'react-icons/fi'
import { useState } from 'react'
import { Group, Menu } from '@mantine/core'
import CreateEditStreamPopover from '../CreateStream/CreateEditStreamPopover'
import { Stream } from '../../types'

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
  setStream(streamId: string): void | Promise<void>
}) {
  const [popoverOpen, setPopoverOpen] = useState(false)

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
      >
        <Menu.Target>{props.children}</Menu.Target>
        <Menu.Dropdown ref={props.ref}>
          <Menu.Label>Layout</Menu.Label>
          <Menu.Item
            onClick={() => props.setStream('')}
            leftSection={<FiX size={14} />}
          >
            Remove
          </Menu.Item>

          <Menu.Divider />

          <Menu.Label>Camera</Menu.Label>
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
          <Menu.Item color="red" leftSection={<FiTrash size={14} />}>
            Delete
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  )
}
