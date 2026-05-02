import { VariableSizeGrid as Grid } from 'react-window'
import { useRef, useEffect, useState, useCallback, type RefObject } from 'react'
import { RecordingThumbItem } from './RecordingThumbItem'
import { FiArrowUp, FiChevronUp } from 'react-icons/fi'
import type { RecordingType } from './Recording'
import type { Stream } from '../../../source/types/shared'

// Helper to measure nickname height
function measureNicknameHeight(
  nickname: string,
  width: number,
  font = 'bold 1.1em sans-serif',
) {
  if (!nickname) return 0
  // Create offscreen span for measurement
  const span = document.createElement('span')
  span.style.visibility = 'hidden'
  span.style.position = 'absolute'
  span.style.font = font
  span.style.whiteSpace = 'pre-wrap'
  span.style.width = width + 'px'
  span.style.lineHeight = '1.2'
  span.innerText = nickname
  document.body.appendChild(span)
  const height = span.offsetHeight
  document.body.removeChild(span)
  return height
}

interface RecordingsListContentProps {
  recordingsListOpen: boolean
  pullDistance: number
  pullThreshold: number
  pullStartY: React.RefObject<number | null>
  gridOuterRef: React.RefObject<HTMLDivElement | null>
  isMobile: boolean
  filteredRecordings: Array<RecordingType>
  search: string
  isNicknamedOnly: boolean
  dateRange: { from?: string | null; to?: string | null }
  isSearching: boolean
  userTyping: boolean
  activeStream: Stream | null
  selected: string[]
  viewingRecordingsFrom: Stream | null
  hovered: string | null
  setHovered: (filename: string | null) => void
  recordingsListRef: React.RefObject<HTMLDivElement | null>
  handleTouchStart: (filename: string, checked: boolean) => void
  handleTouchMove: (e: React.TouchEvent) => void
  handleTouchEnd: () => void
  handleView: (filename: string, motionTimestamps: number[]) => void
  handleCheckboxChange: (filename: string, checked: boolean) => void
  nicknames: Record<string, string>
  viewed: Array<{ filename: string; streamId: string }>
  totalRecordings: Record<string, number>
  cachedRecordings: Record<string, Array<RecordingType>>
  isLoadingMore: boolean
  setIsLoadingMore: (loading: boolean) => void
  setCurrentPage: (page: number) => void
  loadPage: (stream: Stream, page: number, append: boolean) => Promise<void>
  currentPage: number
  mobileSearchSticky: boolean
  setRecordingsListOpen: (open: boolean) => void
  setTransferScrollToPage: (value: boolean) => void
  lastRecordingsListCloseTime: React.RefObject<number>
  videoRef: React.RefObject<HTMLVideoElement | null>
  openingRecording: boolean
  onRequestClose: () => void
  setPullDistance: (distance: number) => void
  transferScrollToPage: boolean // Optional prop for pull-to-close
}

// Item renderer as recommended by react-window docs
const Cell = ({
  columnIndex,
  rowIndex,
  style,
  data,
}: {
  columnIndex: number
  rowIndex: number
  style: React.CSSProperties
  data: {
    numColumns: number
    filteredRecordings: Array<RecordingType>
    selected: string[]
    viewingRecordingsFrom: Stream | null
    activeStream: Stream | null
    hovered: string | null
    setHovered: (filename: string | null) => void
    recordingsListRef: React.RefObject<HTMLDivElement | null>
    handleTouchStart: (filename: string, checked: boolean) => void
    handleTouchMove: (e: React.TouchEvent) => void
    handleTouchEnd: () => void
    handleView: (filename: string, motionTimestamps: number[]) => void
    handleCheckboxChange: (filename: string, checked: boolean) => void
    nicknames: Record<string, string>
    viewed: Array<{ filename: string; streamId: string }>
    // eslint-disable-next-line @typescript-eslint/naming-convention
    THUMB_WIDTH: number
    // eslint-disable-next-line @typescript-eslint/naming-convention
    THUMB_HEIGHT: number
    // eslint-disable-next-line @typescript-eslint/naming-convention
    GRID_GAP: number
  }
}) => {
  const {
    numColumns,
    filteredRecordings,
    selected,
    viewingRecordingsFrom,
    activeStream,
    hovered,
    setHovered,
    recordingsListRef,
    handleTouchStart,
    handleTouchMove,
    handleTouchEnd,
    handleView,
    handleCheckboxChange,
    nicknames,
    viewed,
    THUMB_WIDTH,
    THUMB_HEIGHT,
    GRID_GAP,
  } = data

  const idx = rowIndex * numColumns + columnIndex
  if (idx >= filteredRecordings.length) return null
  const rec = filteredRecordings[idx]
  const checked = selected.includes(rec.filename)
  const recordingsStream = viewingRecordingsFrom ?? activeStream
  const nickname = nicknames[rec.filename]

  return (
    <div style={style}>
      <div
        style={{
          width: THUMB_WIDTH,
          minHeight: THUMB_HEIGHT,
          margin: `${GRID_GAP / 2}px auto`,
          boxSizing: 'border-box',
        }}
      >
        <RecordingThumbItem
          recordingsListRef={recordingsListRef}
          streamId={recordingsStream!.id}
          filename={rec.filename}
          checked={checked}
          hovered={hovered === rec.filename}
          anySelected={selected.length > 0}
          onMouseEnter={() => setHovered(rec.filename)}
          onMouseLeave={() => setHovered(null)}
          onTouchStart={() => handleTouchStart(rec.filename, checked)}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
          onTouchCancel={handleTouchEnd}
          onClick={() => handleView(rec.filename, rec.motionTimestamps)}
          onCheckboxChange={(checked) =>
            handleCheckboxChange(rec.filename, checked)
          }
          nickname={nickname}
          viewed={
            viewed.find(
              (v: { filename: string; streamId: string }) =>
                v.filename === rec.filename &&
                v.streamId === recordingsStream!.id,
            ) !== undefined
          }
        />
      </div>
    </div>
  )
}

export default function RecordingsListContent(
  props: RecordingsListContentProps,
) {
  // Responsive sizing
  const [containerWidth, setContainerWidth] = useState(360)
  const containerRef = useRef<HTMLDivElement>(null)

  // Minimum thumbnail width
  const MIN_THUMB_WIDTH = props.isMobile ? 180 : 200
  const MAX_THUMB_WIDTH = props.isMobile ? 240 : 215
  const GRID_GAP = props.isMobile ? 12 : 16

  // Dynamically calculate columns
  const getNumColumns = useCallback(
    (width: number) => {
      const columns = Math.max(
        1,
        Math.floor((width + GRID_GAP) / (MIN_THUMB_WIDTH + GRID_GAP)),
      )
      return Math.min(5, columns) // Limit to 5 columns
    },
    [GRID_GAP, MIN_THUMB_WIDTH],
  )

  const [numColumns, setNumColumns] = useState(getNumColumns(containerWidth))

  useEffect(() => {
    function updateWidth() {
      const width = window.innerWidth
      setContainerWidth(width)
      setNumColumns(getNumColumns(width))
    }
    updateWidth()
    window.addEventListener('resize', updateWidth)
    return () => window.removeEventListener('resize', updateWidth)
  }, [getNumColumns])

  // Calculate thumbnail width based on columns
  let thumbWidth = Math.max(
    MIN_THUMB_WIDTH,
    (containerWidth - GRID_GAP * numColumns) / numColumns,
  )
  if (thumbWidth > MAX_THUMB_WIDTH) thumbWidth = MAX_THUMB_WIDTH
  const THUMB_HEIGHT = props.isMobile ? 180 : 150

  // Calculate row count
  const rowCount = Math.ceil(props.filteredRecordings.length / numColumns)

  // --- Dynamic row heights for nicknames ---
  // Precompute nickname heights for each row
  const [rowHeights, setRowHeights] = useState<number[]>([])

  useEffect(() => {
    const heights: number[] = []
    for (let row = 0; row < rowCount; row++) {
      let maxHeight = THUMB_HEIGHT
      for (let col = 0; col < numColumns; col++) {
        const idx = row * numColumns + col
        if (idx < props.filteredRecordings.length) {
          const rec = props.filteredRecordings[idx]
          const nickname = props.nicknames[rec.filename]
          if (nickname) {
            const nicknameHeight = measureNicknameHeight(
              nickname,
              thumbWidth - 24,
            ) // 24px padding
            maxHeight = Math.max(maxHeight, THUMB_HEIGHT + nicknameHeight + 8)
          }
        }
      }
      heights[row] = maxHeight + GRID_GAP
    }
    setRowHeights(heights)
  }, [
    props.filteredRecordings,
    props.nicknames,
    thumbWidth,
    rowCount,
    numColumns,
    THUMB_HEIGHT,
    GRID_GAP,
  ])

  // VariableSizeGrid rowHeight/columnWidth
  const rowHeight = (rowIdx: number) =>
    rowHeights[rowIdx] || THUMB_HEIGHT + GRID_GAP
  const columnWidth = () => thumbWidth + GRID_GAP

  // Compose all needed data for the cell renderer
  const itemData = {
    ...props,
    numColumns,
    THUMB_WIDTH: thumbWidth,
    THUMB_HEIGHT,
    GRID_GAP,
  }

  // Ref for VariableSizeGrid to reset row heights if nicknames change
  const gridRef = useRef<Grid | null>(null)

  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.resetAfterRowIndex(0, true)
    }
  }, [rowHeights])

  // Add this effect to reset columns when numColumns, THUMB_WIDTH, or GRID_GAP change
  useEffect(() => {
    if (gridRef.current) {
      gridRef.current.resetAfterColumnIndex(0, true)
    }
  }, [numColumns, thumbWidth, GRID_GAP])

  // --- Touch handling for pull-to-refresh ---
  const handleTouchStart = (e: React.TouchEvent) => {
    const gridAtTop =
      props.gridOuterRef.current?.scrollTop !== undefined
        ? props.gridOuterRef.current.scrollTop <= 50
        : false
    if (gridAtTop) {
      updateRef(props.pullStartY, e.touches[0].clientY)
      props.setPullDistance(0)
    }
  }

  const handleTouchMove = (e: React.TouchEvent) => {
    if (props.pullStartY.current !== null && !props.transferScrollToPage) {
      const delta = e.touches[0].clientY - props.pullStartY.current
      // Always set pullDistance to the current delta, even if user moves back up
      props.setPullDistance(Math.max(0, delta))
    } else if (props.transferScrollToPage) {
      const deltaY =
        e.touches[0].clientY -
        (props.pullStartY.current ?? e.touches[0].clientY)
      window.scrollBy({ top: -deltaY, behavior: 'instant' })
      updateRef(props.pullStartY, e.touches[0].clientY)
      e.preventDefault()
    }
  }

  const handleTouchEnd = () => {
    if (
      props.pullStartY.current !== null &&
      props.pullDistance > props.pullThreshold
    ) {
      props.onRequestClose()
    }
    updateRef(props.pullStartY, null)
    props.setPullDistance(0)
  }

  // --- Render ---
  const gridWidth = numColumns * (thumbWidth + GRID_GAP)

  return (
    <>
      {props.recordingsListOpen && (
        <div
          ref={containerRef}
          className="recordings-grid"
          style={{
            minHeight: props.filteredRecordings.length > 0 ? 'auto' : '200px',
            transition: props.userTyping ? 'none' : 'min-height 0.2s ease-out',
            position: 'relative',
            opacity: props.isSearching ? 0.3 : 1,
            pointerEvents: props.isSearching ? 'none' : 'auto',
            width: props.isMobile ? '100%' : gridWidth,
            margin: '0 auto',
          }}
          onTouchStart={handleTouchStart}
          onTouchMove={handleTouchMove}
          onTouchEnd={handleTouchEnd}
        >
          {props.isMobile && (
            <div
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                right: 0,
                height: 48,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                pointerEvents: 'none',
                zIndex: 10,
                opacity: props.pullDistance > 0 ? 1 : 0,
                transition: 'opacity 0.2s',
                // Blur only, no background color
                backdropFilter: 'blur(10px)',
                WebkitBackdropFilter: 'blur(10px)',
                borderBottom: '1px solid rgba(0,0,0,0.06)',
              }}
            >
              <FiArrowUp
                size={28}
                style={{
                  transform: `translateY(${Math.min(
                    props.pullDistance,
                    props.pullThreshold,
                  )}px) rotate(${
                    props.pullDistance > props.pullThreshold ? 180 : 0
                  }deg)`,
                  color:
                    props.pullDistance > props.pullThreshold
                      ? '#1cf1d1'
                      : '#888',
                  transition: 'transform 0.2s, color 0.2s',
                }}
              />
              <div
                style={{
                  position: 'absolute',
                  top: 12,
                  left: 0,
                  right: 0,
                  textAlign: 'center',
                  fontSize: '0.95em',
                  color: '#fff',
                  textShadow: '0 1px 2px rgba(0,0,0,0.2)',
                  opacity: props.pullDistance > 10 ? 1 : 0,
                  transition: 'opacity 0.2s',
                  pointerEvents: 'none',
                  // Blur only, no background color
                  backdropFilter: 'blur(10px)',
                  WebkitBackdropFilter: 'blur(10px)',
                  borderRadius: 8,
                  margin: '0 24px',
                  padding: '2px 8px',
                  display: 'inline-block',
                }}
              >
                {props.pullDistance > props.pullThreshold
                  ? 'Release to close'
                  : 'Pull up to close'}
              </div>
            </div>
          )}

          <Grid
            ref={gridRef}
            outerRef={props.gridOuterRef}
            columnCount={numColumns}
            columnWidth={columnWidth}
            height={Math.min(6, rowCount) * (THUMB_HEIGHT + GRID_GAP) + 40}
            rowCount={rowCount}
            rowHeight={rowHeight}
            width={props.isMobile ? containerWidth : gridWidth}
            itemData={itemData}
            estimatedRowHeight={THUMB_HEIGHT + 32 + GRID_GAP}
            estimatedColumnWidth={thumbWidth + GRID_GAP}
            overscanRowCount={2}
            overscanColumnCount={1}
          >
            {Cell}
          </Grid>
        </div>
      )}
      {/* Handle */}
      {props.recordingsListOpen && (
        <div
          className="recordings-list-handle-parent"
          style={{
            position: 'sticky',
            bottom: 0,
            userSelect: 'none',
            zIndex: 2,
            height: 56,
            width: '100%',
            display: 'flex',
            flexDirection: 'row',
            alignItems: 'flex-end',
            justifyContent: 'flex-end',
            marginBottom: 12,
            cursor: 'pointer',
            background: 'none',
            border: '0 2px 8px #1a298044',
            transform:
              props.mobileSearchSticky && props.isMobile
                ? `translateY(${isIOS() ? 0 : window.innerHeight * 0.02}px)`
                : 'translateY(0px)',
            transition: 'transform 0.5s cubic-bezier(.4,2,.6,1)',
          }}
          tabIndex={0}
          aria-label="Recordings list handle"
          onClick={() => {
            props.setRecordingsListOpen(false)
            props.setTransferScrollToPage(false)
            updateRef(props.lastRecordingsListCloseTime, Date.now())
            setTimeout(() => {
              props.videoRef.current?.scrollIntoView({
                behavior: 'smooth',
                block: 'center',
              })
            }, 450)
          }}
        >
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              marginRight: 16,
            }}
          >
            <FiChevronUp
              size={48}
              color="#1cf1d1"
              style={{ marginBottom: 0 }}
            />
            <div
              className="recordings-list-handle"
              style={{
                width: 48,
                height: 8,
                borderRadius: 4,
                background: 'rgb(28, 241, 209)',
                margin: '8px 0',
                cursor: 'pointer',
                transition: 'background 0.2s, box-shadow 0.2s',
                boxShadow: '0 2px 8px #1a298044',
              }}
            />
          </div>
        </div>
      )}
    </>
  )

  function isIOS() {
    return (
      /iPad|iPhone|iPod/.test(navigator.userAgent) ||
      (navigator.userAgent.includes('Macintosh') && 'ontouchend' in document)
    )
  }

  function updateRef<T>(ref: RefObject<T>, value: T) {
    ref.current = value
  }
}
