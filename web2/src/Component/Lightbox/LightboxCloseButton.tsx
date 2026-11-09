import {
  type BoxProps,
  CloseButton,
  type CompoundStylesApiProps,
  type ElementProps,
  factory,
  type Factory,
  useProps,
} from '@mantine/core'
import classes from './CollapsedLightbox.module.css'
import { useCollapsedLightboxContext } from './CollapsedLightbox.context'

export type LightboxCloseButtonStylesNames = 'closeButton'

export interface LightboxCloseButtonProps
  extends
    BoxProps,
    CompoundStylesApiProps<LightboxCloseButtonFactory>,
    ElementProps<'button'> {}

export type LightboxCloseButtonFactory = Factory<{
  props: LightboxCloseButtonProps
  ref: HTMLButtonElement
  stylesNames: LightboxCloseButtonStylesNames
  compound: true
}>

export const LightboxCloseButton = factory<LightboxCloseButtonFactory>(
  (props) => {
    const { classNames, className, style, styles, vars, onClick, ...others } =
      useProps('LightboxCloseButton', null, props)

    const ctx = useCollapsedLightboxContext()

    return (
      <CloseButton
        {...ctx.getStyles('closeButton', {
          className,
          style,
          classNames,
          styles,
        })}
        aria-label={ctx.labels.closeLabel}
        variant="subtle"
        size="lg"
        {...others}
        onClick={(event) => {
          onClick?.(event)
          ctx.onClose()
        }}
      />
    )
  },
)

LightboxCloseButton.classes = classes
LightboxCloseButton.displayName = '@mantine/lightbox/LightboxCloseButton'
