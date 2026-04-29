/* eslint-disable react-hooks/refs */
import React, { useEffect, useRef, useState, useCallback } from 'react'
import { type StreamMask } from '../../../source/types/shared'
import type { ClientMask } from '../StreamPage'
import { authFetch } from '../main'

interface MaskEditorOverlayProps {
  pauseMaskPollingUntil: React.RefObject<number>
  masks: ClientMask[]
  setMasks: React.Dispatch<React.SetStateAction<StreamMask[]>>
  streamWidth: number
  streamHeight: number
  maskBaseWidth: number
  maskBaseHeight: number
  style?: React.CSSProperties
  onMaskMove?: (
    maskId: string,
    newPos: { x: number; y: number; w: number; h: number },
  ) => void
  saveMaskPosition?: (
    maskId: string,
    newPos: { x: number; y: number; w: number; h: number },
  ) => void
  setIsDraggingMask?: (dragging: boolean) => void
}

interface DragState {
  maskId: string
  mode: 'move' | 'resize'
  startPointerX: number
  startPointerY: number
  startMaskX: number
  startMaskY: number
  startMaskW: number
  startMaskH: number
  currentPointerX: number
  currentPointerY: number
}

export const MaskEditorOverlay: React.FC<MaskEditorOverlayProps> = ({
  pauseMaskPollingUntil,
  masks,
  streamWidth,
  streamHeight,
  maskBaseWidth,
  maskBaseHeight,
  style = {},
  onMaskMove,
  saveMaskPosition,
  setIsDraggingMask,
}) => {
  const [dragState, setDragState] = useState<DragState | null>(null)
  const [hoveredMaskId, setHoveredMaskId] = useState<string | null>(null)
  const [hoveredResizeId, setHoveredResizeId] = useState<string | null>(null)
  const [settingsOpenId, setSettingsOpenId] = useState<string | null>(null)
  const [settingsAnchor, setSettingsAnchor] = useState<{
    x: number
    y: number
  } | null>(null)
  const [touchSelectedMaskId, setTouchSelectedMaskId] = useState<string | null>(
    null,
  )

  const overlayRef = useRef<HTMLDivElement>(null)
  const dragStateRef = useRef<DragState | null>(null)
  const masksRef = useRef<ClientMask[]>(masks)
  const touchStartTimeRef = useRef<number>(0)
  const touchStartCoordsRef = useRef<{ x: number; y: number } | null>(null)

  // Keep refs updated
  useEffect(() => {
    masksRef.current = masks
  }, [masks])

  useEffect(() => {
    dragStateRef.current = dragState
  }, [dragState])

  // Scale factors
  const scaleX = streamWidth / maskBaseWidth
  const scaleY = streamHeight / maskBaseHeight

  // Check if device supports touch
  const isTouchDevice = 'ontouchstart' in window || navigator.maxTouchPoints > 0

  // Get effective hover state (combines mouse hover and touch selection)
  const getEffectiveHoverState = useCallback(
    (maskId: string) => {
      if (isTouchDevice) {
        return touchSelectedMaskId === maskId
      }
      return hoveredMaskId === maskId
    },
    [isTouchDevice, touchSelectedMaskId, hoveredMaskId],
  )

  // Parse mask data safely
  const parseMask = useCallback((maskObj: ClientMask) => {
    try {
      return typeof maskObj.mask === 'string'
        ? JSON.parse(maskObj.mask)
        : maskObj.mask
    } catch {
      return null
    }
  }, [])

  // Calculate new position during drag
  const calculateDragPosition = useCallback(
    (drag: DragState, currentPointerX: number, currentPointerY: number) => {
      const deltaX = currentPointerX - drag.startPointerX
      const deltaY = currentPointerY - drag.startPointerY

      if (drag.mode === 'move') {
        let newX = drag.startMaskX + deltaX
        let newY = drag.startMaskY + deltaY

        // Clamp to bounds
        newX = Math.max(0, Math.min(maskBaseWidth - drag.startMaskW, newX))
        newY = Math.max(0, Math.min(maskBaseHeight - drag.startMaskH, newY))

        return {
          x: Math.round(newX),
          y: Math.round(newY),
          w: drag.startMaskW,
          h: drag.startMaskH,
        }
      } else if (drag.mode === 'resize') {
        let newW = drag.startMaskW + deltaX
        let newH = drag.startMaskH + deltaY

        // Enforce minimum size and bounds
        newW = Math.max(10, Math.min(maskBaseWidth - drag.startMaskX, newW))
        newH = Math.max(10, Math.min(maskBaseHeight - drag.startMaskY, newH))

        return {
          x: drag.startMaskX,
          y: drag.startMaskY,
          w: Math.round(newW),
          h: Math.round(newH),
        }
      }

      return null
    },
    [maskBaseWidth, maskBaseHeight],
  )

  // Get current mask position - accounting for any ongoing drag
  const getCurrentMaskPosition = useCallback(
    (maskId: string) => {
      const maskObj = masksRef.current.find((m) => m.id === maskId)
      if (!maskObj) return null

      const baseMask = parseMask(maskObj)
      if (!baseMask) return null

      // If this mask is being dragged, calculate its current position
      if (dragStateRef.current && dragStateRef.current.maskId === maskId) {
        const drag = dragStateRef.current
        const currentPos = calculateDragPosition(
          drag,
          drag.currentPointerX,
          drag.currentPointerY,
        )
        if (currentPos) {
          return currentPos
        }
      }

      return { x: baseMask.x, y: baseMask.y, w: baseMask.w, h: baseMask.h }
    },
    [parseMask, calculateDragPosition],
  )

  // Get pointer coordinates in mask space
  const getPointerCoords = useCallback(
    (e: PointerEvent | MouseEvent | TouchEvent) => {
      if (!overlayRef.current) return null

      const rect = overlayRef.current.getBoundingClientRect()
      let clientX, clientY

      if ('touches' in e && e.touches.length > 0) {
        clientX = e.touches[0].clientX
        clientY = e.touches[0].clientY
      } else if ('clientX' in e) {
        clientX = e.clientX
        clientY = e.clientY
      } else {
        return null
      }

      return {
        x: (clientX - rect.left) / scaleX,
        y: (clientY - rect.top) / scaleY,
      }
    },
    [scaleX, scaleY],
  )

  // Find which mask and interaction type is under the pointer
  const getMaskUnderPointer = useCallback(
    (
      pointerX: number,
      pointerY: number,
    ): { maskId: string; mode: 'move' | 'resize' } | null => {
      // Check masks in reverse order (topmost first)
      for (let i = masksRef.current.length - 1; i >= 0; i--) {
        const maskObj = masksRef.current[i]
        const pos = getCurrentMaskPosition(maskObj.id)
        if (!pos) continue

        // Check resize handle area first (bottom-right corner with extended bounds)
        const handleSize = 41 / Math.min(scaleX, scaleY)
        const handleOffset = 8 / Math.min(scaleX, scaleY)
        const handleLeft = pos.x + pos.w - handleSize + handleOffset
        const handleRight = pos.x + pos.w + handleOffset
        const handleTop = pos.y + pos.h - handleSize + handleOffset
        const handleBottom = pos.y + pos.h + handleOffset

        if (
          pointerX >= handleLeft &&
          pointerX <= handleRight &&
          pointerY >= handleTop &&
          pointerY <= handleBottom
        ) {
          return { maskId: maskObj.id, mode: 'resize' }
        }

        // Check mask body area
        if (
          pointerX >= pos.x &&
          pointerX <= pos.x + pos.w &&
          pointerY >= pos.y &&
          pointerY <= pos.y + pos.h
        ) {
          return { maskId: maskObj.id, mode: 'move' }
        }
      }
      return null
    },
    [getCurrentMaskPosition, scaleX, scaleY],
  )

  // Start drag operation
  const handlePointerDown = useCallback(
    (e: React.PointerEvent | React.MouseEvent | React.TouchEvent) => {
      const nativeEvent = e.nativeEvent
      const coords = getPointerCoords(nativeEvent)
      if (!coords) return

      // Store touch start info for touch devices
      if (isTouchDevice) {
        touchStartTimeRef.current = Date.now()
        touchStartCoordsRef.current = coords
      }

      const hit = getMaskUnderPointer(coords.x, coords.y)
      if (!hit) {
        // Clicked/touched outside any mask
        if (isTouchDevice && touchSelectedMaskId) {
          setTouchSelectedMaskId(null)
          e.preventDefault()
          e.stopPropagation()
        }
        return
      }

      const pos = getCurrentMaskPosition(hit.maskId)
      if (!pos) return

      // Prevent default to avoid text selection, etc.
      e.preventDefault()
      e.stopPropagation()

      const newDragState: DragState = {
        maskId: hit.maskId,
        mode: hit.mode,
        startPointerX: coords.x,
        startPointerY: coords.y,
        startMaskX: pos.x,
        startMaskY: pos.y,
        startMaskW: pos.w,
        startMaskH: pos.h,
        currentPointerX: coords.x,
        currentPointerY: coords.y,
      }

      setDragState(newDragState)
      setIsDraggingMask?.(true)

      console.log('Starting drag:', newDragState)
    },
    [
      getPointerCoords,
      getMaskUnderPointer,
      getCurrentMaskPosition,
      setIsDraggingMask,
      isTouchDevice,
      touchSelectedMaskId,
    ],
  )

  // Handle drag movement
  const handlePointerMove = useCallback(
    (e: PointerEvent | MouseEvent | TouchEvent) => {
      const drag = dragStateRef.current
      if (!drag) return

      const coords = getPointerCoords(e)
      if (!coords) return

      // Update the drag state with current pointer position
      const updatedDrag = {
        ...drag,
        currentPointerX: coords.x,
        currentPointerY: coords.y,
      }
      setDragState(updatedDrag)

      const newPos = calculateDragPosition(updatedDrag, coords.x, coords.y)
      if (!newPos) return

      // Update the mask position optimistically
      onMaskMove?.(drag.maskId, newPos)

      e.preventDefault()
    },
    [getPointerCoords, calculateDragPosition, onMaskMove],
  )

  // End drag operation
  const handlePointerUp = useCallback(
    (e: PointerEvent | MouseEvent | TouchEvent) => {
      const drag = dragStateRef.current
      if (!drag) return

      const coords = getPointerCoords(e)
      if (coords) {
        // Check if this was a touch tap rather than a drag
        if (isTouchDevice && touchStartCoordsRef.current) {
          const timeDiff = Date.now() - touchStartTimeRef.current
          const distanceX = Math.abs(coords.x - touchStartCoordsRef.current.x)
          const distanceY = Math.abs(coords.y - touchStartCoordsRef.current.y)
          const totalDistance = Math.sqrt(
            distanceX * distanceX + distanceY * distanceY,
          )

          // Consider it a tap if it was quick and didn't move much
          const isTap = timeDiff < 300 && totalDistance < 10

          if (isTap) {
            // Handle touch selection
            const hit = getMaskUnderPointer(coords.x, coords.y)
            if (hit) {
              if (touchSelectedMaskId === hit.maskId) {
                setTouchSelectedMaskId(null)
              } else {
                setTouchSelectedMaskId(hit.maskId)
              }
            }

            setDragState(null)
            setIsDraggingMask?.(false)
            e.preventDefault()
            return
          }
        }

        const finalPos = calculateDragPosition(drag, coords.x, coords.y)
        if (
          finalPos &&
          !Object.entries(finalPos).every(
            ([key, value]) =>
              drag[
                `startMask${(key.charAt(0).toUpperCase() + key.slice(1)) as 'X' | 'Y' | 'H' | 'W'}`
              ] === value,
          )
        ) {
          console.log('Saving final position:', finalPos)
          saveMaskPosition?.(drag.maskId, finalPos)
        }
      }

      setDragState(null)
      setIsDraggingMask?.(false)

      e.preventDefault()
    },
    [
      getPointerCoords,
      calculateDragPosition,
      saveMaskPosition,
      setIsDraggingMask,
      isTouchDevice,
      getMaskUnderPointer,
      touchSelectedMaskId,
    ],
  )

  // Set up global event listeners
  useEffect(() => {
    const handleGlobalMove = (e: Event) => {
      if (dragStateRef.current) {
        handlePointerMove(e as PointerEvent | MouseEvent | TouchEvent)
      }
    }

    const handleGlobalUp = (e: Event) => {
      if (dragStateRef.current) {
        handlePointerUp(e as PointerEvent | MouseEvent | TouchEvent)
      }
    }

    // Add global listeners for move and up events
    window.addEventListener('pointermove', handleGlobalMove, { passive: false })
    window.addEventListener('pointerup', handleGlobalUp, { passive: false })
    window.addEventListener('mousemove', handleGlobalMove, { passive: false })
    window.addEventListener('mouseup', handleGlobalUp, { passive: false })
    window.addEventListener('touchmove', handleGlobalMove, { passive: false })
    window.addEventListener('touchend', handleGlobalUp, { passive: false })

    return () => {
      window.removeEventListener('pointermove', handleGlobalMove)
      window.removeEventListener('pointerup', handleGlobalUp)
      window.removeEventListener('mousemove', handleGlobalMove)
      window.removeEventListener('mouseup', handleGlobalUp)
      window.removeEventListener('touchmove', handleGlobalMove)
      window.removeEventListener('touchend', handleGlobalUp)
    }
  }, [handlePointerMove, handlePointerUp])

  // Close settings when clicking outside
  useEffect(() => {
    if (!settingsOpenId) return

    const handleClickOutside = () => {
      setSettingsOpenId(null)
    }

    window.addEventListener('pointerdown', handleClickOutside)
    return () => window.removeEventListener('pointerdown', handleClickOutside)
  }, [settingsOpenId])

  // Clear touch selection when settings are opened
  useEffect(() => {
    if (settingsOpenId && isTouchDevice) {
      setTouchSelectedMaskId(null)
    }
  }, [settingsOpenId, isTouchDevice])

  return (
    <div
      ref={overlayRef}
      style={{
        position: 'absolute',
        left: 0,
        top: 0,
        width: streamWidth,
        height: streamHeight,
        pointerEvents: 'auto',
        zIndex: 10,
        ...style,
      }}
      onPointerDown={handlePointerDown}
      onMouseDown={handlePointerDown}
      onTouchStart={handlePointerDown}
    >
      {masks.map((maskObj) => {
        const currentPos = getCurrentMaskPosition(maskObj.id)
        if (!currentPos) return null

        const isDragging = dragState?.maskId === maskObj.id
        const isPending = !!maskObj.pendingUpdate
        const isSelected = getEffectiveHoverState(maskObj.id) // For touch devices, this includes touch selection

        return (
          <div
            key={maskObj.id}
            style={{
              position: 'absolute',
              left: currentPos.x * scaleX,
              top: currentPos.y * scaleY,
              width: currentPos.w * scaleX,
              height: currentPos.h * scaleY,
              pointerEvents: isPending ? 'none' : 'auto',
              opacity: isPending ? 0.7 : 1,
              transition: isDragging ? 'none' : 'opacity 0.2s',
            }}
            onPointerEnter={() => setHoveredMaskId(maskObj.id)}
            onPointerLeave={() => setHoveredMaskId(null)}
          >
            {/* Main mask body */}
            <div
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: '100%',
                height: '100%',
                border: isDragging
                  ? '3px solid #ff9800'
                  : isSelected
                    ? '3px solid #4caf50'
                    : '3px solid #2196f3',
                background: isDragging
                  ? 'rgba(255,152,0,0.25)'
                  : isSelected
                    ? 'rgba(76,175,80,0.25)'
                    : 'rgba(33,150,243,0.2)',
                boxShadow: isDragging
                  ? '0 4px 16px rgba(255,152,0,0.4), inset 0 0 20px rgba(255,152,0,0.1)'
                  : isSelected
                    ? '0 3px 14px rgba(76,175,80,0.35), inset 0 0 18px rgba(76,175,80,0.1)'
                    : '0 2px 12px rgba(33,150,243,0.3), inset 0 0 15px rgba(33,150,243,0.08)',
                borderRadius: 6,
                boxSizing: 'border-box',
                cursor: isPending
                  ? 'not-allowed'
                  : isSelected
                    ? hoveredResizeId === maskObj.id
                      ? 'nwse-resize'
                      : 'move'
                    : 'pointer',
                transition: isDragging ? 'none' : 'all 0.15s',
                userSelect: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                touchAction: 'none',
              }}
              title={maskObj.type || 'Mask'}
            >
              {/* Move mask icon */}
              <span
                style={{
                  opacity: isDragging
                    ? dragState.mode === 'move'
                      ? 1
                      : 0
                    : isSelected && hoveredResizeId !== maskObj.id
                      ? 1
                      : 0,
                  transform:
                    (isSelected && hoveredResizeId !== maskObj.id) ||
                    (isDragging && dragState.mode === 'move')
                      ? 'translate(-50%, -50%) scale(1)'
                      : 'translate(-50%, -50%) scale(0.2)',
                  transition:
                    'opacity 0.25s cubic-bezier(.4,2,.6,1), transform 0.25s cubic-bezier(.4,2,.6,1)',
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  pointerEvents: 'none',
                  zIndex: 3,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                }}
              >
                <svg
                  width={Math.max(32, currentPos.w * scaleX * 0.4)}
                  height={Math.max(32, currentPos.h * scaleY * 0.4)}
                  viewBox="0 0 572.156 572.156"
                  fill={isDragging ? '#ff9800' : 'none'}
                  strokeWidth={isDragging ? 0 : 20}
                  stroke="#2196f3"
                  style={{
                    opacity: 0.8,
                    filter: 'drop-shadow(0 3px 8px rgba(0,0,0,0.25))',
                    display: 'block',
                  }}
                  version="1.1"
                  id="Capa_1"
                  xmlns="http://www.w3.org/2000/svg"
                  xmlnsXlink="http://www.w3.org/1999/xlink"
                  xmlSpace="preserve"
                >
                  <g>
                    <polygon
                      points="495.405,241.769 418.657,197.457 418.657,258.115 314.042,258.115 314.042,153.498 374.699,153.498 
            330.389,76.751 286.078,0 241.769,76.751 197.457,153.498 258.115,153.498 258.115,258.115 153.498,258.115 153.498,197.457 
            76.751,241.767 0,286.078 76.751,330.387 153.498,374.699 153.498,314.042 258.115,314.042 258.115,418.657 197.457,418.657 
            241.767,495.405 286.078,572.156 330.387,495.405 374.699,418.657 314.042,418.657 314.042,314.042 418.657,314.042 
            418.657,374.699 495.405,330.389 572.156,286.078 	"
                    />
                  </g>
                </svg>
              </span>

              {/* Resize handle */}
              <span
                data-mask-element="true"
                data-resize-handle="true"
                style={{
                  position: 'absolute',
                  right: -8,
                  bottom: -8,
                  width: 41,
                  height: 41,
                  zIndex: 2,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  pointerEvents: 'auto',
                  touchAction: 'none',
                  userSelect: 'none',
                  WebkitUserSelect: 'none',
                  MozUserSelect: 'none',
                  msUserSelect: 'none',
                  opacity: isDragging ? 1 : 0.7,
                  transition: 'opacity 0.2s cubic-bezier(.4,2,.6,1)',
                  cursor: isPending ? 'not-allowed' : 'nwse-resize',
                }}
                onPointerEnter={
                  isPending ? undefined : () => setHoveredResizeId(maskObj.id)
                }
                onPointerLeave={
                  isPending ? undefined : () => setHoveredResizeId(null)
                }
              >
                <svg
                  width={41}
                  height={41}
                  viewBox="0 0 41 41"
                  style={{
                    display: 'block',
                    pointerEvents: 'none',
                  }}
                >
                  {/* Circle */}
                  <circle
                    style={{
                      transition:
                        'r 0.25s cubic-bezier(.4,2,.6,1), cx 0.25s cubic-bezier(.4,2,.6,1), cy 0.25s cubic-bezier(.4,2,.6,1)',
                      mixBlendMode: 'plus-lighter', // Use additive blending to avoid stacking opacity
                    }}
                    cx={
                      isDragging
                        ? dragState.mode === 'resize'
                          ? 20.5
                          : 20.5
                        : hoveredResizeId === maskObj.id
                          ? 20.5
                          : 20.5
                    }
                    cy={
                      isDragging
                        ? dragState.mode === 'resize'
                          ? 20.5
                          : 20.5
                        : hoveredResizeId === maskObj.id
                          ? 18.5
                          : 20.5
                    }
                    r={
                      isDragging
                        ? dragState.mode === 'resize'
                          ? 13.5
                          : 0
                        : hoveredResizeId === maskObj.id
                          ? 11.5
                          : 9.5
                    }
                    fill={
                      isDragging
                        ? 'rgba(255,152,0,0.25)'
                        : 'rgba(100, 243, 33, 0.25)'
                    }
                    stroke={isDragging ? '#ff9800' : '#4caf50'}
                    strokeWidth="3"
                  />
                  {/* Arrow triangles */}
                  <g
                    style={{
                      transition: 'transform 0.25s cubic-bezier(.4,2,.6,1)',
                      transform:
                        hoveredResizeId === maskObj.id
                          ? 'scale(2.0)'
                          : 'scale(1.3)',
                      transformOrigin: '20.5px 20.5px', // Center of circle
                    }}
                  >
                    {/* Arrow pointing to top-left */}
                    <polygon
                      points={
                        isDragging
                          ? `17.5,17.5 17.5,21.5 21.5,17.5`
                          : hoveredResizeId === maskObj.id
                            ? `17.5,16.5 17.5,20.5 21.5,16.5`
                            : `17.5,17.5 17.5,21.5 21.5,17.5`
                      }
                      fill={
                        isDragging
                          ? dragState.mode === 'resize'
                            ? '#ff9800'
                            : dragState.mode === 'move'
                              ? 'none'
                              : '#4caf50'
                          : '#4caf50'
                      }
                      style={{
                        transition: 'fill 0.25s cubic-bezier(.4,2,.6,1)',
                      }}
                    />
                    {/* Arrow pointing to bottom-right */}
                    <polygon
                      points={
                        isDragging
                          ? `23.5,23.5 23.5,19.5 19.5,23.5`
                          : hoveredResizeId === maskObj.id
                            ? `23.5,22.5 23.5,18.5 19.5,22.5`
                            : `23.5,23.5 23.5,19.5 19.5,23.5`
                      }
                      fill={
                        isDragging
                          ? dragState.mode === 'resize'
                            ? '#ff9800'
                            : dragState.mode === 'move'
                              ? 'none'
                              : '#4caf50'
                          : '#4caf50'
                      }
                      style={{
                        transition: 'fill 0.25s cubic-bezier(.4,2,.6,1)',
                      }}
                    />
                  </g>
                </svg>
              </span>

              <button
                data-mask-element="true"
                disabled={isPending}
                onPointerDown={async (e) => {
                  e.stopPropagation()
                  // Find the mask being deleted
                  const deletedMask = maskObj

                  masksRef.current = (() => {
                    const newMasks = masksRef.current.filter(
                      (m) => m.id !== maskObj.id,
                    )
                    // Find the mask under the deleted one with the largest overlap area
                    const maskA =
                      typeof deletedMask.mask === 'string'
                        ? JSON.parse(deletedMask.mask)
                        : deletedMask.mask
                    let maxOverlap = 0
                    let mostOverlapping: typeof maskObj | undefined
                    for (const m of newMasks) {
                      const maskB =
                        typeof m.mask === 'string' ? JSON.parse(m.mask) : m.mask
                      const x_overlap = Math.max(
                        0,
                        Math.min(maskA.x + maskA.w, maskB.x + maskB.w) -
                          Math.max(maskA.x, maskB.x),
                      )
                      const y_overlap = Math.max(
                        0,
                        Math.min(maskA.y + maskA.h, maskB.y + maskB.h) -
                          Math.max(maskA.y, maskB.y),
                      )
                      const overlapArea = x_overlap * y_overlap
                      if (overlapArea > maxOverlap) {
                        maxOverlap = overlapArea
                        mostOverlapping = m
                      }
                    }
                    if (mostOverlapping) {
                      const mask =
                        typeof mostOverlapping.mask === 'string'
                          ? JSON.parse(mostOverlapping.mask)
                          : mostOverlapping.mask
                      setHoveredMaskId(mask.id)
                    }
                    return newMasks
                  })()
                  // After any mask API update:
                  pauseMaskPollingUntil.current = Date.now() + 1000 // Pause for 1 second
                  await authFetch(
                    `/api/masks/${maskObj.streamId}/${maskObj.id}`,
                    {
                      method: 'DELETE',
                      headers: { 'Content-Type': 'application/json' },
                    },
                  )
                }}
                style={{
                  position: 'absolute',
                  top: -16,
                  right: -16,
                  zIndex: 20,
                  background: '#ff5252',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '50%',
                  width: 32,
                  height: 32,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
                  cursor: 'pointer',
                  opacity:
                    isSelected ||
                    (isDragging && dragState.maskId === maskObj.id)
                      ? 0.96
                      : 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition:
                    'background 0.2s, opacity 0.35s cubic-bezier(.4,2,.6,1), transform 0.35s cubic-bezier(.4,2,.6,1)',
                  outline: 'none',
                  padding: 0,
                  pointerEvents: isPending
                    ? 'none'
                    : isSelected ||
                        (isDragging && dragState.maskId === maskObj.id)
                      ? 'auto'
                      : 'none',
                  transform:
                    isSelected ||
                    (isDragging && dragState.maskId === maskObj.id)
                      ? 'scale(1)'
                      : 'scale(0.2)',
                }}
                title="Delete mask"
              >
                {/* Trash can icon */}
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                  <path
                    d="M7 10v7M12 10v7M17 10v7"
                    stroke="#fff"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                  <rect
                    x="5"
                    y="7"
                    width="14"
                    height="13"
                    rx="2"
                    stroke="#fff"
                    strokeWidth="2"
                    fill="none"
                  />
                  <rect x="9" y="3" width="6" height="3" rx="1.5" fill="#fff" />
                  <rect x="3" y="6" width="18" height="2" rx="1" fill="#fff" />
                </svg>
              </button>

              {/* Settings Cog */}
              <span
                data-mask-element="true"
                style={{
                  position: 'absolute',
                  top: -16,
                  left: -16,
                  zIndex: 30,
                  background: 'rgba(30,30,30,0.92)',
                  color: '#fff',
                  border: 'none',
                  borderRadius: '50%',
                  width: 32,
                  height: 32,
                  boxShadow: '0 2px 8px rgba(0,0,0,0.18)',
                  cursor: 'pointer',
                  opacity:
                    isSelected ||
                    (isDragging && dragState.maskId === maskObj.id)
                      ? 0.96
                      : 0,
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  transition:
                    'background 0.2s, opacity 0.35s cubic-bezier(.4,2,.6,1), transform 0.35s cubic-bezier(.4,2,.6,1)',
                  outline: 'none',
                  padding: 0,
                  pointerEvents: isPending
                    ? 'none'
                    : isSelected ||
                        (isDragging && dragState.maskId === maskObj.id)
                      ? 'auto'
                      : 'none',
                  transform:
                    isSelected ||
                    (isDragging && dragState.maskId === maskObj.id)
                      ? 'scale(1)'
                      : 'scale(0.2)',
                }}
                onPointerDown={(e) => {
                  e.stopPropagation()
                  e.preventDefault()
                  setSettingsOpenId(maskObj.id)
                  // Position popout near cog
                  const rect = (e.target as HTMLElement).getBoundingClientRect()
                  setSettingsAnchor({
                    x: rect.left + rect.width / 2,
                    y: rect.bottom,
                  })
                }}
                title="Mask settings"
              >
                {/* Cog SVG */}
                <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                  <circle
                    cx="10"
                    cy="10"
                    r="7"
                    stroke="#2196f3"
                    strokeWidth="2"
                    fill="#fff"
                  />
                  <path
                    d="M10 5v2M10 13v2M5 10h2M13 10h2M7.5 7.5l1 1M11.5 11.5l1 1M7.5 12.5l1-1M11.5 8.5l1-1"
                    stroke="#2196f3"
                    strokeWidth="1.2"
                    strokeLinecap="round"
                  />
                </svg>
              </span>

              {/* Settings Popout */}
              {settingsOpenId === maskObj.id && settingsAnchor && (
                <div
                  style={{
                    position: 'fixed',
                    left: settingsAnchor.x,
                    top: settingsAnchor.y + 4,
                    zIndex: 10000,
                    background: 'rgba(30,30,30,0.98)',
                    borderRadius: 12,
                    boxShadow: '0 4px 24px #1a2980cc',
                    padding: '16px 20px',
                    minWidth: 180,
                    color: '#fff',
                    fontFamily: 'Roboto, Arial, sans-serif',
                    fontSize: 15,
                    userSelect: 'none',
                    pointerEvents: 'auto',
                    cursor: 'default',
                  }}
                  onPointerDown={(e) => {
                    e.stopPropagation()
                    e.preventDefault()
                  }}
                >
                  <div style={{ fontWeight: 600, marginBottom: 8 }}>
                    Disable on
                  </div>
                  <label
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      cursor: 'pointer',
                      marginBottom: 4,
                    }}
                  >
                    <input
                      type="checkbox"
                      checked={maskObj.type === 'conditional'}
                      disabled={maskObj.pendingUpdate}
                      onChange={async (e) => {
                        const newType = e.target.checked
                          ? 'conditional'
                          : 'fixed'
                        masksRef.current = masksRef.current.map((m) =>
                          m.id === maskObj.id ? { ...m, type: newType } : m,
                        )
                        // eslint-disable-next-line react-hooks/immutability
                        maskObj.pendingUpdate = true
                        // API update using PATCH
                        await authFetch(
                          `/api/masks/${maskObj.streamId}/${maskObj.id}`,
                          {
                            method: 'PATCH',
                            headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({
                              mask: { ...parseMask(maskObj), type: newType },
                            }),
                          },
                        )
                        maskObj.pendingUpdate = false
                      }}
                      style={{ accentColor: '#2196f3', width: 18, height: 18 }}
                    />
                    Camera motion
                  </label>
                  <button
                    style={{
                      marginTop: 10,
                      background: '#222',
                      color: '#fff',
                      border: 'none',
                      borderRadius: 6,
                      padding: '4px 12px',
                      cursor: 'pointer',
                      fontSize: 14,
                    }}
                    onClick={(e) => {
                      e.stopPropagation()
                      e.preventDefault()
                      setSettingsOpenId(null)
                    }}
                  >
                    Close
                  </button>
                </div>
              )}

              {/* Pending update spinner */}
              {maskObj.pendingUpdate && (
                <div
                  style={{
                    position: 'absolute',
                    left: 0,
                    top: 0,
                    width: '100%',
                    height: '100%',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    zIndex: 99,
                    pointerEvents: 'none',
                    background: 'rgba(255,255,255,0.15)',
                  }}
                >
                  {/* Simple spinner SVG */}
                  <svg width="32" height="32" viewBox="0 0 50 50">
                    <circle
                      cx="25"
                      cy="25"
                      r="20"
                      fill="none"
                      stroke="#2196f3"
                      strokeWidth="5"
                      strokeDasharray="31.4 31.4"
                      strokeLinecap="round"
                    >
                      <animateTransform
                        attributeName="transform"
                        type="rotate"
                        from="0 25 25"
                        to="360 25 25"
                        dur="1s"
                        repeatCount="indefinite"
                      />
                    </circle>
                  </svg>
                </div>
              )}

              {/* Mask label */}
              <span
                style={{
                  position: 'absolute',
                  left: '50%',
                  top: '50%',
                  transform:
                    (isSelected && hoveredResizeId !== maskObj.id) ||
                    (isDragging && dragState.mode === 'move')
                      ? 'translate(-50%, -190%)'
                      : 'translate(-50%, -50%)',
                  color: '#2196f3',
                  fontWeight: 800,
                  fontSize: Math.max(18, currentPos.h * scaleY * 0.14),
                  textShadow:
                    '0 3px 12px rgba(0,0,0,0.5), 0 1px 4px rgba(33,150,243,0.3)',
                  pointerEvents: 'none',
                  zIndex: 10,
                  transition:
                    'transform 0.35s cubic-bezier(.4,2,.6,1), opacity 0.25s cubic-bezier(.4,2,.6,1)',
                  opacity: isDragging || maskObj.pendingUpdate ? 0 : 1,
                  userSelect: 'none',
                  whiteSpace: 'nowrap',
                }}
              >
                Drag to edit
              </span>
            </div>
          </div>
        )
      })}
    </div>
  )
}
