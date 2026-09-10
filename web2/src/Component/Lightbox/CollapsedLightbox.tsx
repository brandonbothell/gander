import { FiTrash } from 'react-icons/fi'
import { useEffect, useRef, useState } from 'react'
import { modals } from '@mantine/modals'
import {
  createCloseToolbarItem,
  createDownloadToolbarItem,
  createFullscreenToolbarItem,
  createThumbnailsToolbarItem,
  type LightboxSlideData,
  type LightboxProps,
  type ToolbarItem,
  type ToolbarItemsPayload,
} from '@mantine/lightbox'
import { Text } from '@mantine/core'
import { Recording } from '../../types'
import { authFetch } from '../../main'
import { LightboxSlides } from './Slides/LightboxSlides'
import { LightboxSlide } from './Slides/LightboxSlide'
import { LightboxToolbar } from './LightboxToolbar'
import { LightboxThumbnails } from './LightboxThumbnails'
import { LightboxRoot } from './LightboxRoot'
import { LightboxNavigation } from './LightboxNavigation'
import { LightboxCaption } from './LightboxCaption'

export type CollapsedLightboxSlideData = LightboxSlideData & {
  title?: React.ReactNode
  recording: Recording & { page: number; index: number }
}

export interface CollapsedLightboxProps extends LightboxProps {
  currentSrc: string
  activeRecording: (Recording & { page: number; index: number }) | null
  recordings: Map<string, (Recording & { page: number; index: number })[][]>
  recordingsCount: Map<string, number>
  onRecordingDeleted?: (
    recording: Recording & { page: number; index: number },
  ) => void | Promise<void>
  slides: CollapsedLightboxSlideData[]
}

export default function CollapsedLightbox({
  children,
  toolbarItems,
  ...props
}: CollapsedLightboxProps) {
  const payloadRef = useRef<ToolbarItemsPayload | null>(null)
  const [thumbnailsVisible, setThumbnailsVisible] = useState(false)
  const openDeleteModal = (filename: string) =>
    new Promise<boolean>((resolve) =>
      modals.openConfirmModal({
        title: 'Delete recording',
        children: <Text size="sm">Delete {filename}?</Text>,
        labels: { confirm: 'Delete', cancel: 'Cancel' },
        onCancel: () => resolve(false),
        onConfirm: () => resolve(true),
        zIndex: 1003,
      }),
    )

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
      setThumbnailsVisible((visible) => !visible)
    }

    return [
      createThumbnailsToolbarItem(
        toggleThumbnails,
        thumbnailsVisible,
        payload.labels,
      ),
      {
        key: 'delete',
        icon: <FiTrash />,
        label: 'Delete recording',
        async onClick() {
          if (!props.activeRecording) return
          if (!(await openDeleteModal(props.activeRecording!.filename))) return

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
    <LightboxRoot
      {...{
        ...props,
        onRecordingDeleted: undefined,
        recordingsCount: undefined,
        activeRecording: undefined,
        currentSrc: undefined,
        recordings: undefined,
      }}
    >
      {children ?? (
        <>
          <LightboxToolbar toolbarItems={resolvedToolbarItems} />
          <LightboxSlides>
            {props.slides.map((slide, index) => (
              <LightboxSlide key={index} slide={slide} index={index} />
            ))}
          </LightboxSlides>
          <LightboxNavigation />
          <LightboxCaption />
          <LightboxThumbnails
            style={{ display: thumbnailsVisible ? undefined : 'none' }}
          />
        </>
      )}
    </LightboxRoot>
  )
}

export type { LightboxProps }
