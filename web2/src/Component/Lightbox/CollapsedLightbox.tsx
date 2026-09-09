import { FiTrash } from 'react-icons/fi'
import { useEffect, useRef, useState } from 'react'
import {
  createCloseToolbarItem,
  createDownloadToolbarItem,
  createFullscreenToolbarItem,
  createThumbnailsToolbarItem,
  Lightbox,
  type LightboxProps,
  type ToolbarItem,
  type ToolbarItemsPayload,
} from '@mantine/lightbox'
import { Recording } from '../../types'
import { authFetch } from '../../main'

type CollapsedLightboxProps = LightboxProps & {
  currentSrc: string
  activeRecording: (Recording & { page: number; index: number }) | null
  recordings: Map<string, (Recording & { page: number; index: number })[][]>
  recordingsCount: Map<string, number>
  onRecordingDeleted?: (
    recording: Recording & { page: number; index: number },
  ) => void | Promise<void>
}

export default function CollapsedLightbox({
  children,
  toolbarItems,
  ...props
}: CollapsedLightboxProps) {
  const payloadRef = useRef<ToolbarItemsPayload | null>(null)
  const [thumbnailsVisible, setThumbnailsVisible] = useState(false)

  useEffect(() => {
    if (!props.opened) {
      setThumbnailsVisible(false)
    }
  }, [props.opened])

  const resolvedToolbarItems = (
    payload: ToolbarItemsPayload,
  ): ToolbarItem[] => {
    payloadRef.current = payload

    if (typeof toolbarItems === 'function') {
      return toolbarItems(payload)
    }

    if (toolbarItems) {
      return toolbarItems
    }

    const toggleThumbnails = () => {
      if (thumbnailsVisible) {
        payload.toggleThumbnails()
      }
      setThumbnailsVisible((visible) => !visible)
    }

    return [
      createThumbnailsToolbarItem(
        toggleThumbnails,
        thumbnailsVisible,
        payload.labels,
      ),
      {
        key: 'edit',
        icon: <FiTrash />,
        label: 'Delete recording',
        onClick: async () => {
          if (!props.activeRecording) return
          if (!window.confirm(`Delete ${props.activeRecording.filename}?`)) {
            return
          }
          const res = await authFetch(
            `/api/recordings/${props.activeRecording.streamId}/${props.activeRecording.filename}`,
            {
              method: 'DELETE',
            },
          )
          if (res.ok && (await res.json()).success) {
            props.onRecordingDeleted?.(props.activeRecording)
          }
        },
        position: 'right',
      },
      createDownloadToolbarItem(props.currentSrc, payload.labels),
      createFullscreenToolbarItem(
        payload.toggleFullscreen,
        payload.isFullscreen,
        payload.labels,
      ),
      createCloseToolbarItem(payload.close, payload.labels),
    ]
  }

  return (
    <Lightbox.Root {...props}>
      {children ?? (
        <>
          <Lightbox.Toolbar toolbarItems={resolvedToolbarItems} />
          <Lightbox.Slides>
            {props.slides.map((slide, index) => (
              <Lightbox.Slide key={index} slide={slide} index={index} />
            ))}
          </Lightbox.Slides>
          <Lightbox.Navigation />
          <Lightbox.Caption />
          <Lightbox.Thumbnails
            style={{ display: thumbnailsVisible ? undefined : 'none' }}
          />
        </>
      )}
    </Lightbox.Root>
  )
}

export type { LightboxProps }
