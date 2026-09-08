import { useEffect, useRef, useState } from 'react'
import {
  createCloseToolbarItem,
  createFullscreenToolbarItem,
  createThumbnailsToolbarItem,
  Lightbox,
  type LightboxProps,
  type ToolbarItem,
  type ToolbarItemsPayload,
} from '@mantine/lightbox'

type CollapsedLightboxProps = LightboxProps

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
