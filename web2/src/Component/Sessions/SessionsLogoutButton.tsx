import { FiChevronDown, FiLogOut, FiUsers } from 'react-icons/fi'
import { ActionIcon, Button, Group, Menu, useMantineTheme } from '@mantine/core'
import classes from './SessionsLogoutButton.module.css'

export function SessionsLogoutButton(
  props?: React.ComponentPropsWithoutRef<typeof Group> & {
    logout: (skipBroadcast?: boolean) => Promise<void>
  },
) {
  const theme = useMantineTheme()

  return (
    <Group wrap="nowrap" gap={0} {...props}>
      <Button leftSection={<FiUsers size={16} />} className={classes.button}>
        Sessions
      </Button>
      <Menu
        transitionProps={{ transition: 'pop' }}
        position="bottom-end"
        withinPortal
      >
        <Menu.Target>
          <ActionIcon
            variant="filled"
            color={theme.primaryColor}
            size={36}
            className={classes.menuControl}
            aria-label="More options"
          >
            <FiChevronDown size={16} />
          </ActionIcon>
        </Menu.Target>
        <Menu.Dropdown>
          <Menu.Item
            onClick={() => props?.logout()}
            leftSection={<FiLogOut size={16} color={theme.colors.red[5]} />}
          >
            Logout
          </Menu.Item>
        </Menu.Dropdown>
      </Menu>
    </Group>
  )
}
