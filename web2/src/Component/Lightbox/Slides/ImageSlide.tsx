import type { LightboxImageSlide } from '@mantine/lightbox'
import { useCollapsedLightboxContext } from '../CollapsedLightbox.context'
import type { LightboxSlideStylesApiProps } from './LightboxSlide'

interface ImageSlideProps {
  slide: LightboxImageSlide
  active: boolean
  stylesApiProps?: LightboxSlideStylesApiProps
}

export function ImageSlide({ slide, active, stylesApiProps }: ImageSlideProps) {
  const ctx = useCollapsedLightboxContext()
  const { style: zoomStyle, ...zoomProps } =
    active && ctx.withZoom ? ctx.getImageZoomProps() : { style: undefined }

  return (
    <img
      {...ctx.getStyles('slideImage', { ...stylesApiProps, style: zoomStyle })}
      src={slide.src}
      alt={slide.alt ?? ''}
      srcSet={slide.srcSet}
      sizes={slide.sizes}
      loading={slide.loading ?? (active ? 'eager' : 'lazy')}
      draggable={false}
      data-reduce-motion="true"
      {...zoomProps}
    />
  )
}

ImageSlide.displayName = '@mantine/lightbox/ImageSlide'
