import React, { useCallback, useEffect, useState } from 'react'
import { notifications } from '@mantine/notifications'
import { useDisclosure, useViewportSize } from '@mantine/hooks'
import { Button, Group, Popover, Stack, TextInput } from '@mantine/core'
import { Stream } from '../../types'
import { API_BASE, authFetch } from '../../main'
import StreamTypeControl from './StreamTypeControl'

export default function CreateEditStreamPopover(props: {
  currentStream?: Stream
  streams: Map<string, Stream>
  setOpen?: (open: boolean) => void
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
  setStream(streamId: string): Promise<void> | void
  children: React.ReactNode
}) {
  const { width } = useViewportSize()
  const [loading, setLoading] = useState(false)
  const [open, { set: setOpen, toggle: toggleOpen }] = useDisclosure(false)

  const [nickname, setNickname] = useState('')
  const [type, setType] = useState<'RTSP' | 'Local'>('RTSP')

  const [localVideoDevice, setLocalVideo] = useState('')
  const [localAudioDevice, setLocalAudio] = useState('')

  const [rtspUrl, setRTSPUrl] = useState('')
  const [rtspUsername, setRTSPUsername] = useState('')
  const [rtspPassword, setRTSPPassword] = useState('')

  /* useEffect(() => {
    if (props.create && props.edit) {
      throw new TypeError(
        'Cannot supply both "edit" and "create" to CreateStreamPopover',
      )
    }
    if (!props.create && !props.edit) {
      throw new TypeError(
        'Missing one of "edit" or "create" in CreateStreamPopover',
      )
    }
  }, [props.create, props.edit]) */

  const resetInputs = useCallback(() => {
    if (props.currentStream) {
      if (props.currentStream.ffmpegInput.startsWith('rtsp://')) {
        setType('RTSP')
        setRTSPUrl(props.currentStream.ffmpegInput.slice(7))
        setRTSPUsername(props.currentStream.rtspUser ?? '')
        setRTSPPassword(props.currentStream.rtspPass ?? '')
      } else {
        setType('Local')
        const audioIndex =
          props.currentStream.ffmpegInput.lastIndexOf(':audio=')
        setLocalVideo(props.currentStream.ffmpegInput.slice(6, audioIndex))
        setLocalAudio(props.currentStream.ffmpegInput.slice(audioIndex + 8))
      }

      setNickname(props.currentStream.nickname)
    } else {
      setType('RTSP')
      setNickname('')
      setRTSPUrl('')
      setRTSPUsername('')
      setRTSPPassword('')
      setLocalVideo('')
      setLocalAudio('')
    }
  }, [props.currentStream])

  useEffect(resetInputs, [props.currentStream])

  useEffect(() => props.setOpen?.(open), [open])

  return (
    <Popover
      width={width > 768 ? '50dvw' : '90dvw'}
      opened={open}
      onDismiss={() => setOpen(false)}
      shadow="md"
      withArrow
      closeOnClickOutside={false}
      hideDetached={false}
      withOverlay
      overlayProps={{
        zIndex: 10000,
        blur: '8px',
      }}
      zIndex={10001}
    >
      <Popover.Target>
        {React.Children.map(props.children, (child) => {
          // Ensure it's a valid React element before cloning
          if (React.isValidElement(child)) {
            return React.cloneElement(child, {
              // @ts-ignore
              onClick: (event) => {
                event.preventDefault()
                event.stopPropagation()
                toggleOpen()
              },
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
                type="password"
                value={rtspPassword}
                onChange={(event) => setRTSPPassword(event.currentTarget.value)}
              />
            </>
          )}
          <Group justify="flex-end" gap="xs">
            <>
              {props.currentStream && (
                <Button
                  color="red"
                  disabled={loading}
                  onClick={async () => {
                    setLoading(true)
                    const res = await authFetch(
                      `${API_BASE}/api/streams/${props.currentStream!.id}`,
                      {
                        method: 'DELETE',
                      },
                    )

                    if (!res.ok) {
                      const body = await res.json().catch(() => ({}))
                      notifications.show({
                        message: body.error || 'Failed to delete stream.',
                        color: 'red',
                      })
                      setLoading(false)
                      return
                    }

                    props.setStream('')
                    props.setLayouts((prev) =>
                      prev.map((layout) => {
                        let streamIndex = 0
                        while (streamIndex !== -1) {
                          streamIndex = layout.splitterStreams.indexOf(
                            props.currentStream!.id,
                          )
                          delete layout.splitterStreams[streamIndex]
                        }
                        return layout
                      }),
                    )
                    props.streams.delete(props.currentStream!.id)
                  }}
                >
                  Delete
                </Button>
              )}
              {props.currentStream && (
                <Button
                  variant="default"
                  disabled={loading}
                  onClick={async () => {
                    const notif = notifications.show({
                      message: `Reconnecting to ${props.currentStream!.nickname}...`,
                      autoClose: false,
                      allowClose: false,
                      priority: 10,
                      loading: true,
                      loaderProps: {
                        size: 18,
                        type: 'bars',
                      },
                    })
                    setLoading(true)
                    const res = await authFetch(
                      `${API_BASE}/api/streams/${props.currentStream!.id}/reconnect`,
                      {
                        method: 'POST',
                      },
                    )

                    if (!res.ok) {
                      const body = await res.json().catch(() => ({}))
                      notifications.hide(notif)
                      notifications.show({
                        message: body.error || 'Failed to reconnect to camera.',
                        color: 'red',
                      })
                      setLoading(false)
                      return
                    }

                    notifications.hide(notif)
                    notifications.show({
                      message: `Reconnected to ${props.currentStream!.nickname}`,
                      color: 'teal',
                    })
                    setLoading(false)
                  }}
                >
                  Reconnect
                </Button>
              )}
              <Button
                variant="default"
                disabled={loading}
                onClick={() => {
                  setOpen(false)
                  resetInputs()
                }}
              >
                Cancel
              </Button>
              <Button
                disabled={loading}
                onClick={async () => {
                  setLoading(true)

                  // Create or update
                  if (!props.currentStream) {
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
                      setLoading(false)
                      return
                    }

                    const newStream = (await res.json()) as Stream

                    setTimeout(() => {
                      props.streams.set(newStream.id, newStream)
                      props.setStream(newStream.id)
                      setLoading(false)
                      setOpen(false)
                    }, 1000) // Give time for the stream to initialize
                  } else {
                    // Build PATCH body with all fields, only if changed
                    const patch: Record<string, string | undefined> = {}
                    if (nickname.trim() !== props.currentStream.nickname) {
                      patch.nickname = nickname.trim()
                    }

                    if (type === 'RTSP') {
                      if (rtspUrl.trim() !== props.currentStream.ffmpegInput) {
                        patch.ffmpegInput = `rtsp://${rtspUrl}`
                      }
                      if (
                        rtspUsername.trim() !== props.currentStream.rtspUser
                      ) {
                        patch.rtspUser = rtspUsername.trim()
                      }
                      if (
                        rtspPassword.trim() !== props.currentStream.rtspPass
                      ) {
                        patch.rtspPass = rtspPassword.trim()
                      }
                    } else {
                      const ffmpegInput = `video=${localVideoDevice.trim()}:audio=${localAudioDevice.trim()}`

                      if (ffmpegInput !== props.currentStream.ffmpegInput) {
                        patch.ffmpegInput = ffmpegInput
                      }
                    }

                    if (Object.keys(patch).length > 0) {
                      const res = await authFetch(
                        `${API_BASE}/api/streams/${props.currentStream.id}`,
                        {
                          method: 'PATCH',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify(patch),
                        },
                      )

                      if (!res.ok) {
                        const data = await res.json().catch(() => ({}))
                        notifications.show({
                          message: data.error || 'Failed to update stream.',
                          color: 'red',
                        })
                        setLoading(false)
                        return
                      }

                      props.setStream('')
                      const newStream = (await res.json()) as Stream
                      setTimeout(() => {
                        props.streams.set(newStream.id, newStream)
                        props.setStream(newStream.id)
                        setLoading(false)
                        setOpen(false)
                      }, 1000) // Give the stream time to initialize
                    }
                  }
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
