import { FiSettings, FiTrash, FiX } from 'react-icons/fi'
import { Group, Menu } from '@mantine/core'
import { Stream } from '../../types'

export default function StreamEditMenu(props: {
  ref?: React.Ref<HTMLDivElement>
  children: React.ReactNode
  streams: Map<string, Stream>
}) {
  return (
    <Group wrap="nowrap" gap={0}>
      <Menu
        transitionProps={{ transition: 'pop' }}
        position="bottom-end"
        withinPortal
        styles={{
          dropdown: {
            zIndex: 1003,
          },
        }}
      >
        <Menu.Target>{props.children}</Menu.Target>
        <Menu.Dropdown ref={props.ref}>
          <Menu.Label>Layout</Menu.Label>
          <Menu.Item leftSection={<FiX size={14} />}>Remove</Menu.Item>

          <Menu.Divider />

          <Menu.Label>Camera</Menu.Label>
          <Menu.Item leftSection={<FiSettings size={14} />}>Settings</Menu.Item>
          <Menu.Item color="red" leftSection={<FiTrash size={14} />}>
            Delete
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  )
}
