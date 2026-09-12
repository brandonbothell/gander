import React, { useState } from 'react'
import { notifications } from '@mantine/notifications'
import { useDisclosure, useViewportSize } from '@mantine/hooks'
import { Button, Group, Popover, Stack, TextInput } from '@mantine/core'
import { Stream } from '../../types'
import { API_BASE, authFetch } from '../../main'
import StreamTypeControl from './StreamTypeControl'

export default function CreateStreamPopover(props: {
  streams: Map<string, Stream>
  setStream(streamId: string): Promise<void> | void
  children: React.ReactNode
}) {
  const { width } = useViewportSize()
  const [creatingStream, setCreatingStream] = useState(false)
  const [open, { set: setOpen, toggle: toggleOpen }] = useDisclosure(false)

  const [nickname, setNickname] = useState('')
  const [type, setType] = useState<'RTSP' | 'Local'>('RTSP')

  const [localVideoDevice, setLocalVideo] = useState('')
  const [localAudioDevice, setLocalAudio] = useState('')

  const [rtspUrl, setRTSPUrl] = useState('')
  const [rtspUsername, setRTSPUsername] = useState('')
  const [rtspPassword, setRTSPPassword] = useState('')

  return (
    <Popover
      width={width > 768 ? '50vw' : '90vw'}
      opened={open}
      onDismiss={() => setOpen(false)}
      shadow="md"
      withArrow
      withOverlay
      overlayProps={{ zIndex: 10000, blur: '8px' }}
      zIndex={10001}
    >
      <Popover.Target>
        {React.Children.map(props.children, (child) => {
          // Ensure it's a valid React element before cloning
          if (React.isValidElement(child)) {
            return React.cloneElement(child, {
              // @ts-ignore
              onClick: () => toggleOpen(),
            })
          }
          return child
        })}
      </Popover.Target>
      <Popover.Dropdown>
        <Stack gap="sm">
          <StreamTypeControl setType={setType} default={type} />
          <TextInput
            label="Nickname"
            value={nickname}
            onChange={(event) => setNickname(event.currentTarget.value)}
          />
          {type === 'Local' ? (
            <>
              <TextInput
                label="Local video device"
                value={localVideoDevice}
                onChange={(event) => setLocalVideo(event.currentTarget.value)}
              />
              <TextInput
                label="Local audio device"
                value={localAudioDevice}
                onChange={(event) => setLocalAudio(event.currentTarget.value)}
              />
            </>
          ) : (
            <>
              <TextInput
                label="Camera IP"
                leftSection={'rtsp://'}
                leftSectionWidth={50}
                value={rtspUrl}
                onChange={(event) => setRTSPUrl(event.currentTarget.value)}
              />
              <TextInput
                label="RTSP username"
                value={rtspUsername}
                onChange={(event) => setRTSPUsername(event.currentTarget.value)}
              />
              <TextInput
                label="RTSP password"
                value={rtspPassword}
                onChange={(event) => setRTSPPassword(event.currentTarget.value)}
              />
            </>
          )}
          <Group justify="flex-end" gap="xs">
            <>
              <Button
                variant="default"
                disabled={creatingStream}
                onClick={() => {
                  setOpen(false)
                  setType('RTSP')
                  setNickname('')
                  setRTSPUsername('')
                  setRTSPPassword('')
                  setLocalVideo('')
                  setLocalAudio('')
                }}
              >
                Cancel
              </Button>
              <Button
                onClick={async () => {
                  setCreatingStream(true)
                  const res = await authFetch(`${API_BASE}/api/streams`, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                      nickname: nickname.trim(),
                      ffmpegInput:
                        type === 'Local'
                          ? `video=${localVideoDevice.trim()}:audio=${localAudioDevice.trim()}`
                          : `rtsp://${rtspUrl.trim()}`,
                      rtspUser:
                        type === 'RTSP' ? rtspUsername.trim() : undefined,
                      rtspPass:
                        type === 'RTSP' ? rtspPassword.trim() : undefined,
                    }),
                  })

                  if (!res.ok) {
                    const data = await res.json().catch(() => ({}))
                    notifications.show({
                      message: data.error || 'Failed to create stream.',
                      color: 'red',
                    })
                    setCreatingStream(false)
                    return
                  }

                  const newStream = (await res.json()) as Stream
                  props.streams.set(newStream.id, newStream)

                  props.setStream(newStream.id)
                  setCreatingStream(false)
                  setOpen(false)
                }}
              >
                Save
              </Button>
            </>
          </Group>
        </Stack>
      </Popover.Dropdown>
    </Popover>
  )
}
