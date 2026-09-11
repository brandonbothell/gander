import { FiChevronDown, FiPlus } from 'react-icons/fi'
import { ActionIcon, Button, Group, Menu } from '@mantine/core'
import { Stream } from '../../types'
import classes from './StreamAddButton.module.css'

export default function StreamAddButton(props: {
  color?: string
  streams: Map<string, Stream>
  setStream: (streamId: string) => void | Promise<void>
}) {
  return (
    <Group wrap="nowrap" gap={0}>
      <Button
        leftSection={<FiPlus size={16} />}
        color={props.color}
        className={classes.button}
      >
        New camera
      </Button>
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
        <Menu.Target>
          <ActionIcon
            variant="filled"
            color={props.color}
            size={36}
            className={classes.menuControl}
            aria-label="More options"
          >
            <FiChevronDown size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Label>Cameras</Menu.Label>
          {props.streams
            .entries()
            .toArray()
            .map((stream, index) => (
              <Menu.Item
                key={stream[0]}
                onClick={() => props.setStream(stream[0])}
              >
                {stream[1].nickname ? stream[1].nickname : `Camera ${index}`}
              </Menu.Item>
            ))}
        </Menu.Dropdown>
      </Menu>
    </Group>
  )
}
