import {
  type ToolbarItems,
  type ToolbarItem,
  createThumbnailsToolbarItem,
  createFullscreenToolbarItem,
  createDownloadToolbarItem,
  createCloseToolbarItem,
} from '@mantine/lightbox'
import { useViewportSize } from '@mantine/hooks'
import {
  Box,
  type BoxProps,
  type CompoundStylesApiProps,
  type ElementProps,
  type Factory,
  factory,
  UnstyledButton,
  useProps,
} from '@mantine/core'
import RecordingRenamePopover from '../Recordings/RecordingRenamePopover'
import { Recording } from '../../types'
import classes from './CollapsedLightbox.module.css'
import { useCollapsedLightboxContext } from './CollapsedLightbox.context'

export type LightboxToolbarStylesNames =
  | 'toolbar'
  | 'toolbarGroup'
  | 'toolbarButton'
  | 'title'

export interface LightboxToolbarProps
  extends
    BoxProps,
    CompoundStylesApiProps<LightboxToolbarFactory>,
    ElementProps<'div'> {
  /** Custom toolbar items, overrides default toolbar actions. Can be a function that receives the current lightbox state and handlers. */
  toolbarItems?: ToolbarItems
  recordings: Map<string, (Recording & { page: number; index: number })[][]>
}

export type LightboxToolbarFactory = Factory<{
  props: LightboxToolbarProps
  ref: HTMLDivElement
  stylesNames: LightboxToolbarStylesNames
  compound: true
}>

export const LightboxToolbar = factory<LightboxToolbarFactory>((props) => {
  const {
    classNames,
    className,
    style,
    styles,
    vars,
    toolbarItems,
    ...others
  } = useProps('LightboxToolbar', null, props)

  const ctx = useCollapsedLightboxContext()
  const stylesApiProps = { classNames, styles }
  const currentSlide = ctx.slides[ctx.currentIndex]
  const { width } = useViewportSize()

  const defaultItems: ToolbarItem[] = []

  if (ctx.withThumbnails) {
    defaultItems.push(
      createThumbnailsToolbarItem(
        ctx.toggleThumbnails,
        ctx.thumbnailsVisible,
        ctx.labels,
      ),
    )
  }

  if (ctx.withFullscreen) {
    defaultItems.push(
      createFullscreenToolbarItem(
        ctx.toggleFullscreen,
        ctx.isFullscreen,
        ctx.labels,
      ),
    )
  }

  if (ctx.withDownload && currentSlide && currentSlide.type !== 'custom') {
    defaultItems.push(createDownloadToolbarItem(currentSlide.src, ctx.labels))
  }

  defaultItems.push(createCloseToolbarItem(ctx.onClose, ctx.labels))

  const items =
    typeof toolbarItems === 'function'
      ? toolbarItems({
          slides: ctx.slides,
          currentIndex: ctx.currentIndex,
          setIndex: ctx.setIndex,
          next: ctx.next,
          prev: ctx.prev,
          close: ctx.onClose,
          thumbnailsVisible: ctx.thumbnailsVisible,
          toggleThumbnails: ctx.toggleThumbnails,
          isFullscreen: ctx.isFullscreen,
          toggleFullscreen: ctx.toggleFullscreen,
          zoomed: ctx.zoomState.isZoomed,
          toggleZoom: ctx.toggleZoom,
          labels: ctx.labels,
        })
      : (toolbarItems ?? defaultItems)
  const leftItems = items.filter((item) => item.position === 'left')
  const rightItems = items.filter((item) => item.position !== 'left')

  return (
    <Box
      {...ctx.getStyles('toolbar', { className, style, classNames, styles })}
      {...others}
    >
      <div {...ctx.getStyles('toolbarGroup', stylesApiProps)}>
        {leftItems.map((item) => (
          <UnstyledButton
            key={item.key}
            {...ctx.getStyles('toolbarButton', stylesApiProps)}
            mod="reduce-motion"
            aria-label={item.label}
            onClick={item.onClick}
          >
            {item.icon}
          </UnstyledButton>
        ))}
      </div>

      {width > 600 && (
        <span {...ctx.getStyles('title', stylesApiProps)}>
          {ctx.currentTitle ?? null}
        </span>
      )}

      <div {...ctx.getStyles('toolbarGroup', stylesApiProps)}>
        <RecordingRenamePopover
          recordings={props.recordings}
          key="edit"
          recording={ctx.slides[ctx.currentIndex].recording}
        />
        {rightItems.map((item) => (
          <UnstyledButton
            key={item.key}
            {...ctx.getStyles('toolbarButton', stylesApiProps)}
            mod="reduce-motion"
            aria-label={item.label}
            onClick={item.onClick}
          >
            {item.icon}
          </UnstyledButton>
        ))}
      </div>
    </Box>
  )
})

LightboxToolbar.classes = classes
LightboxToolbar.displayName = '@mantine/lightbox/LightboxToolbar'
