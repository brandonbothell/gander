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
          /* if (res.ok) {
            const streamRecordings = props.recordings.get(
              props.activeRecording.streamId,
            )!
            let currentPage = streamRecordings[props.activeRecording.page - 1]
            const deletedIndex = currentPage.findIndex(
              (r) => props.activeRecording!.filename === r.filename,
            )

            currentPage.splice(deletedIndex, 1)
            let lastPage = {
              items: currentPage,
              index: props.activeRecording.page - 1,
            }

            // Shift the recordings to keep page sizes consistent with the API
            for (
              let i = props.activeRecording.page;
              i < streamRecordings.length;
              i++
            ) {
              let nextPage = streamRecordings[i]
              const shiftedRecording = nextPage.shift()
              if (shiftedRecording) {
                nextPage = nextPage.map((rec, index) =>
                  index > shiftedRecording.index
                    ? { ...rec, index: rec.index-- }
                    : rec,
                )
                lastPage.items.push(shiftedRecording)
                streamRecordings[lastPage.index] = lastPage.items
                lastPage = { items: nextPage, index: lastPage.index + 1 }
              } else if (lastPage.items.length === 0) {
                delete streamRecordings[lastPage.index]
              }
              streamRecordings[i] = nextPage
            }

            streamRecordings[props.activeRecording.page - 1] = currentPage
            props.recordings.set(
              props.activeRecording.streamId,
              streamRecordings,
            )
            props.recordingsCount.set(
              props.activeRecording.streamId,
              props.recordingsCount.get(props.activeRecording.streamId)! - 1,
            ) 
            props.onRecordingDeleted?.(props.activeRecording)
          } else {
            alert('Failed to delete recording.')
          }*/

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
