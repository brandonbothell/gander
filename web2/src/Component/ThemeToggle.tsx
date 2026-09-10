import { useEffect } from 'react'
import { IconMoon, IconSun } from '@tabler/icons-react'
import { useLocalStorage } from '@mantine/hooks'
import {
  ActionIcon,
  Group,
  type MantineColorScheme,
  useComputedColorScheme,
  useMantineColorScheme,
} from '@mantine/core'
import classes from './ThemeToggle.module.css'

export function ThemeToggle() {
  const { setColorScheme } = useMantineColorScheme()
  const computedColorScheme = useComputedColorScheme('dark', {
    getInitialValueInEffect: true,
  })
  const [savedScheme, setSavedScheme] = useLocalStorage<MantineColorScheme>({
    key: 'mantine-color-scheme-value',
    defaultValue: 'dark',
  })

  useEffect(() => {
    if (savedScheme) setColorScheme(savedScheme)
  }, [savedScheme])

  return (
    <Group
      style={{ marginLeft: 'auto', pointerEvents: 'auto' }}
      pos="absolute"
      right={175}
    >
      <ActionIcon
        onClick={() => {
          setSavedScheme(computedColorScheme === 'light' ? 'dark' : 'light')
        }}
        variant="default"
        size="xl"
        radius="md"
        aria-label="Toggle color scheme"
      >
        <IconSun className={`${classes.icon} ${classes.light}`} stroke={1.5} />
        <IconMoon className={`${classes.icon} ${classes.dark}`} stroke={1.5} />
      </ActionIcon>
    </Group>
  )
}
