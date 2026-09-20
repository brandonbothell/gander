import type { EmblaCarouselType } from 'embla-carousel'
import { type LightboxLabels } from '@mantine/lightbox'
import {
  createSafeContext,
  type Factory,
  type GetStylesApi,
} from '@mantine/core'
import {
  LightboxCssVariables,
  LightboxRootProps,
  LightboxRootStylesNames,
} from './LightboxRoot'
import { CollapsedLightboxSlideData } from './CollapsedLightbox'

export interface CollapsedLightboxContextValue {
  getStyles: GetStylesApi<
    Factory<{
      props: LightboxRootProps
      ref: HTMLDivElement
      stylesNames: LightboxRootStylesNames
      vars: LightboxCssVariables
    }>
  >
  labels: LightboxLabels
  opened: boolean
  slides: CollapsedLightboxSlideData[]
  currentIndex: number
  currentTitle: React.ReactNode
  setIndex: (index: number) => void
  next: () => void
  prev: () => void
  embla: EmblaCarouselType | null
  emblaRef: React.RefCallback<HTMLDivElement> | null
  withZoom: boolean
  withThumbnails: boolean
  withFullscreen: boolean
  withDownload: boolean
  thumbnailsVisible: boolean
  toggleThumbnails: () => void
  isFullscreen: boolean
  toggleFullscreen: () => void
  zoomState: { scale: number; isZoomed: boolean }
  toggleZoom: () => void
  getImageZoomProps: () => Record<string, any>
  onClose: () => void
  loop: boolean
  closeOnClickOutside: boolean
  closeOnSwipeDown: boolean
  transitionDuration: number
}

export const [CollapsedLightboxContextProvider, useCollapsedLightboxContext] =
  createSafeContext<CollapsedLightboxContextValue>(
    'Collapsed Lightbox component was not found in tree',
  )
