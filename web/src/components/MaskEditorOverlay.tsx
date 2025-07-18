import React, { useEffect, useRef, useState } from 'react';
import { type StreamMask } from '../../../types/shared';
import { authFetch } from '../main';
import type { ClientMask } from '../StreamPage';

interface MaskEditorOverlayProps {
  pauseMaskPollingUntil: React.RefObject<number>;
  masks: ClientMask[];
  setMasks: React.Dispatch<React.SetStateAction<StreamMask[]>>;
  streamWidth: number;
  streamHeight: number;
  maskBaseWidth: number;
  maskBaseHeight: number;
  style?: React.CSSProperties;
  onMaskMove?: (maskId: string, newPos: { x: number; y: number, w: number, h: number }) => void;
  saveMaskPosition?: (maskId: string, newPos: { x: number; y: number, w: number, h: number }) => void;
  setIsDraggingMask?: (dragging: boolean) => void;
}

export const MaskEditorOverlay: React.FC<MaskEditorOverlayProps> = ({
  pauseMaskPollingUntil,
  masks,
  setMasks,
  streamWidth,
  streamHeight,
  maskBaseWidth,
  maskBaseHeight,
  style = {},
  onMaskMove,
  saveMaskPosition,
  setIsDraggingMask,
}) => {
  const [dragging, setDragging] = useState<
    | null
    | {
      id: string;
      mode: 'move' | 'resize';
      offsetX: number;
      offsetY: number;
      origX: number;
      origY: number;
      origW?: number;
      origH?: number;
    }
  >(null);
  const [pendingPos, setPendingPos] = useState<{ [id: string]: { x: number; y: number, w: number, h: number } }>({});
  const [hoveredMaskId, setHoveredMaskId] = useState<string | null>(null);
  const [hoveredResizeId, setHoveredResizeId] = useState<string | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);
  const pendingPosRef = useRef<{ [id: string]: { x: number; y: number, w: number, h: number } }>({});
  const lastDragOffsetRef = useRef<{ [maskId: string]: { offsetX: number; offsetY: number; mode: 'move' | 'resize' } }>({});
  const [settingsOpenId, setSettingsOpenId] = useState<string | null>(null);
  const [settingsAnchor, setSettingsAnchor] = useState<{ x: number, y: number } | null>(null);

  const scaleX = streamWidth / maskBaseWidth;
  const scaleY = streamHeight / maskBaseHeight;

  function getRelativeCoords(e: React.MouseEvent | React.TouchEvent) {
    const rect = overlayRef.current?.getBoundingClientRect();
    let clientX = 0, clientY = 0;
    if ('touches' in e && e.touches.length > 0) {
      clientX = e.touches[0].clientX;
      clientY = e.touches[0].clientY;
    } else if ('clientX' in e) {
      clientX = e.clientX;
      clientY = e.clientY;
    }
    return {
      x: ((clientX - (rect?.left ?? 0)) / scaleX),
      y: ((clientY - (rect?.top ?? 0)) / scaleY),
    };
  }

  function startDrag(
    e: React.MouseEvent | React.TouchEvent,
    maskObj: StreamMask,
    mask: { x: number; y: number; w: number; h: number },
    mode: 'move' | 'resize'
  ) {
    e.stopPropagation();
    e.preventDefault();
    const coords = getRelativeCoords(e);

    let offsetX = coords.x - mask.x;
    let offsetY = coords.y - mask.y;
    if (mode === 'resize') {
      offsetY = coords.y - (mask.y + mask.h);
    }
    // Store the offset for this mask
    lastDragOffsetRef.current[maskObj.id] = { offsetX, offsetY, mode };

    setDragging({
      id: maskObj.id,
      mode,
      offsetX,
      offsetY,
      origX: mask.x,
      origY: mask.y,
      origW: mask.w,
      origH: mask.h,
    });
    setPendingPosSafe({ [maskObj.id]: { x: mask.x, y: mask.y, w: mask.w, h: mask.h } });
    if (setIsDraggingMask) setIsDraggingMask(true);
    window.addEventListener('pointermove', handlePointerMove as any);
    window.addEventListener('pointerup', handlePointerUp as any);
  }

  function setPendingPosSafe(newPos: { [id: string]: { x: number; y: number, w: number, h: number } }) {
    pendingPosRef.current = { ...pendingPosRef.current, ...newPos };
    setPendingPos(prev => ({ ...prev, ...newPos }));
  }

  function handlePointerMove(e: MouseEvent | TouchEvent) {
    if (!dragging) return;
    e.preventDefault();
    const maskObj = masks.find(m => m.id === dragging.id);
    if (!maskObj) return;
    let mask;
    try {
      mask = typeof maskObj.mask === 'string' ? JSON.parse(maskObj.mask) : maskObj.mask;
    } catch {
      return;
    }
    let clientX = 0, clientY = 0;
    if ('touches' in e && e.touches.length > 0) {
      clientX = (e as TouchEvent).touches[0].clientX;
      clientY = (e as TouchEvent).touches[0].clientY;
    } else if ('clientX' in e) {
      clientX = (e as MouseEvent).clientX;
      clientY = (e as MouseEvent).clientY;
    }
    const rect = overlayRef.current?.getBoundingClientRect();
    const relX = (clientX - (rect?.left ?? 0)) / scaleX;
    const relY = (clientY - (rect?.top ?? 0)) / scaleY;

    const minWidth = 20, minHeight = 20;

    if (dragging.mode === 'move') {
      let newX = Math.round(relX - dragging.offsetX);
      let newY = Math.round(relY - dragging.offsetY);

      // Clamp so mask stays fully inside canvas
      newX = Math.max(0, Math.min(maskBaseWidth - mask.w, newX));
      newY = Math.max(0, Math.min(maskBaseHeight - mask.h, newY));

      setPendingPosSafe({ [maskObj.id]: { x: newX, y: newY, w: Math.round(mask.w), h: Math.round(mask.h) } });
      if (onMaskMove) onMaskMove(maskObj.id, { x: newX, y: newY, w: Math.round(mask.w), h: Math.round(mask.h) });
    } else if (dragging.mode === 'resize') {
      // The pointer should control the bottom-left corner
      // Calculate the new bottom-left position
      const left = relX - dragging.offsetX;
      const bottom = relY - dragging.offsetY;

      // New width is from left to original right edge
      let newW = Math.round(dragging.origX + dragging.origW! - left);
      // New height is from original top to new bottom
      let newH = Math.round(bottom - dragging.origY);

      // Clamp width and height
      newW = Math.max(minWidth, Math.min(newW, dragging.origX + dragging.origW!));
      newH = Math.max(minHeight, Math.min(newH, maskBaseHeight - dragging.origY));

      // Clamp x so mask stays in bounds
      let newX = Math.round(dragging.origX + dragging.origW! - newW);
      if (newX < 0) {
        newW += newX;
        newX = 0;
      }
      // Clamp width so right edge stays in bounds
      if (newX + newW > maskBaseWidth) {
        newW = maskBaseWidth - newX;
      }

      setPendingPosSafe({ [maskObj.id]: { x: newX, y: Math.round(mask.y), w: newW, h: newH } });
      if (onMaskMove) onMaskMove(maskObj.id, { x: newX, y: Math.round(mask.y), w: newW, h: newH });
    }
  }

  function handlePointerUp(e: PointerEvent) {
    if (!dragging) return;
    e.preventDefault();
    window.removeEventListener('pointermove', handlePointerMove as any);
    window.removeEventListener('pointerup', handlePointerUp as any);

    // Only call saveMaskPosition if position changed
    const pos =
      pendingPosRef.current[dragging.id] ??
      (() => {
        // fallback: get mask's current position from props
        const maskObj = masks.find(m => m.id === dragging.id);
        if (!maskObj) return undefined;
        try {
          const mask = typeof maskObj.mask === 'string' ? JSON.parse(maskObj.mask) : maskObj.mask;
          return { x: mask.x, y: mask.y, w: mask.w, h: mask.h };
        } catch {
          return undefined;
        }
      })();

    if (pos && saveMaskPosition) {
      saveMaskPosition(dragging.id, pos);
    }
    if (setIsDraggingMask) setIsDraggingMask(false);
    setDragging(null);
    setPendingPos({});
  }

  // Close settings when clicking outside
  useEffect(() => {
    if (!settingsOpenId) return;
    function close(_: MouseEvent) {
      setSettingsOpenId(null);
    }
    window.addEventListener('pointerdown', close);
    return () => window.removeEventListener('pointerdown', close);
  }, [settingsOpenId]);

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
      onPointerDown={() => {
        // Only unset dragging if clicking/tapping empty space (not on a mask)
        if (dragging) {
          setDragging(null);
          setPendingPos({});
          setIsDraggingMask?.(false);
        }
      }}
    >
      {masks.map(maskObj => {
        let mask;
        try {
          mask = typeof maskObj.mask === 'string' ? JSON.parse(maskObj.mask) : maskObj.mask;
        } catch {
          return null;
        }
        const isDragging = dragging && dragging.id === maskObj.id;
        const isPending = !!maskObj.pendingUpdate;
        const dragPos = isDragging && pendingPos[maskObj.id]
          ? pendingPos[maskObj.id]
          : { x: mask.x, y: mask.y, w: mask.w, h: mask.h };
        return (
          <div
            key={maskObj.id}
            style={{
              position: 'absolute',
              left: dragPos.x * scaleX,
              top: dragPos.y * scaleY,
              width: dragPos.w * scaleX,
              height: dragPos.h * scaleY,
              pointerEvents: 'none',
              opacity: isPending ? 0.8 : 1,
              transition: 'opacity 0.2s',
            }}
            onPointerEnter={() => setHoveredMaskId(maskObj.id)}
            onPointerLeave={() => setHoveredMaskId(null)}
          >
            <div
              draggable={false}
              style={{
                position: 'absolute',
                left: 0,
                top: 0,
                width: '100%',
                height: '100%',
                border: isDragging ? '2px solid #ff9800' : '2px solid #2196f3',
                background: isDragging ? 'rgba(255,152,0,0.18)' : 'rgba(33,150,243,0.18)',
                mixBlendMode: 'plus-lighter',
                borderRadius: 6,
                pointerEvents: isPending ? 'none' : 'auto',
                boxSizing: 'border-box',
                touchAction: 'none',
                cursor: isPending ? 'not-allowed' : (isDragging ? 'move' : 'pointer'),
                transition: isDragging ? 'none' : 'border 0.15s, background 0.15s',
                userSelect: 'none',
                WebkitUserSelect: 'none',
                MozUserSelect: 'none',
                msUserSelect: 'none',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                maskImage: 'radial-gradient(circle 16px at 16px 100%, white 16px, black 17px)',
                WebkitMaskImage: 'radial-gradient(circle 16px at 16px 100%, white 16px, black 17px)',
              }}
              title={maskObj.type || ''}
              onPointerDown={isPending ? undefined : e => {
                e.preventDefault();
                // Remove focus from any element (including this mask)
                if (document.activeElement instanceof HTMLElement) {
                  document.activeElement.blur();
                }
                startDrag(e, maskObj, mask, 'move');
              }}
            >
              {/* Move mask icon */}
              <span
                style={{
                  opacity:
                    isDragging
                      ? dragging?.mode === 'move'
                        ? 1
                        : 0
                      : (hoveredMaskId === maskObj.id && hoveredResizeId !== maskObj.id)
                        ? 1
                        : 0,
                  transform:
                    (hoveredMaskId === maskObj.id && hoveredResizeId !== maskObj.id) || (isDragging && dragging?.mode === 'move')
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
                <svg width={Math.max(32, dragPos.w * scaleX * 0.4)}
                  height={Math.max(32, dragPos.h * scaleY * 0.4)}
                  viewBox="0 0 572.156 572.156"
                  fill={isDragging ? '#ff9800' : 'none'}
                  strokeWidth={isDragging ? 0 : 16}
                  stroke='#2196f3'
                  style={{
                    opacity: 0.7,
                    filter: 'drop-shadow(0 2px 4px rgba(0,0,0,0.18))',
                    display: 'block',
                  }} version="1.1" id="Capa_1" xmlns="http://www.w3.org/2000/svg" xmlnsXlink="http://www.w3.org/1999/xlink"
                  xmlSpace="preserve">
                  <g>
                    <polygon points="495.405,241.769 418.657,197.457 418.657,258.115 314.042,258.115 314.042,153.498 374.699,153.498 
            330.389,76.751 286.078,0 241.769,76.751 197.457,153.498 258.115,153.498 258.115,258.115 153.498,258.115 153.498,197.457 
            76.751,241.767 0,286.078 76.751,330.387 153.498,374.699 153.498,314.042 258.115,314.042 258.115,418.657 197.457,418.657 
            241.767,495.405 286.078,572.156 330.387,495.405 374.699,418.657 314.042,418.657 314.042,314.042 418.657,314.042 
            418.657,374.699 495.405,330.389 572.156,286.078 	"/>
                  </g>
                </svg>
              </span>
              {/* Show resize handle always, but only allow resizing on pointer down */}
              <span
                style={{
                  position: 'absolute',
                  left: -8,
                  bottom: -8,
                  width: 42,
                  height: 42,
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
                onPointerEnter={isPending ? undefined : () => setHoveredResizeId(maskObj.id)}
                onPointerLeave={isPending ? undefined : () => setHoveredResizeId(null)}
                onPointerDown={isPending ? undefined : e => {
                  e.preventDefault();
                  e.stopPropagation();
                  if (document.activeElement instanceof HTMLElement) {
                    document.activeElement.blur();
                  }
                  startDrag(e, maskObj, mask, 'resize');
                }}
              >
                <svg
                  width={42}
                  height={42}
                  viewBox="0 0 42 42"
                  style={{
                    display: 'block',
                    pointerEvents: 'none',
                  }}
                >
                  {/* Circle */}
                  <circle
                    style={{
                      transition: 'r 0.25s cubic-bezier(.4,2,.6,1), cx 0.25s cubic-bezier(.4,2,.6,1), cy 0.25s cubic-bezier(.4,2,.6,1)',
                      mixBlendMode: 'plus-lighter', // Use additive blending to avoid stacking opacity
                    }}
                    cx={isDragging
                      ? (dragging?.mode === 'resize' ? 20 : 13)
                      : (hoveredResizeId === maskObj.id ? 20 : 13)}
                    cy={isDragging
                      ? (dragging?.mode === 'resize' ? 21 : 30)
                      : (hoveredResizeId === maskObj.id ? 21 : 30)}
                    r={isDragging
                      ? (dragging?.mode === 'resize' ? 14 : 0)
                      : (hoveredResizeId === maskObj.id ? 12 : 10)}
                    fill={isDragging ? 'rgba(255,152,0,0.18)' : 'rgba(33,150,243,0.18)'}
                    stroke={isDragging ? "#ff9800" : "#2196f3"}
                    strokeWidth="2"
                  />
                  {/* Arrow triangles */}
                  <g
                    style={{
                      transition: 'transform 0.25s cubic-bezier(.4,2,.6,1)',
                      transform: hoveredResizeId === maskObj.id
                        ? 'translate(1px, -1px)'
                        : 'translate(0,0)',
                    }}
                  >
                    {/* Bigger arrow at 45deg (top-right) */}
                    <polygon
                      points="17,6 26,6 26,15"
                      fill={
                        isDragging
                          ? (dragging?.mode === 'resize' ? '#ff9800' : 'none')
                          : (hoveredResizeId === maskObj.id ? '#2196f3' : 'none')
                      }
                      transform="rotate(14 -24 8)"
                      style={{
                        transition: 'fill 0.25s cubic-bezier(.4,2,.6,1)',
                      }}
                    />
                  </g>
                  <g
                    style={{
                      transition: 'transform 0.25s cubic-bezier(.4,2,.6,1)',
                      transform: hoveredResizeId === maskObj.id
                        ? 'translate(-1px, 1px)'
                        : 'translate(0,0)',
                    }}
                  >
                    {/* Bigger arrow at 225deg (bottom-left) */}
                    <polygon
                      points="6,17 6,26 15,26"
                      fill={
                        isDragging
                          ? (dragging?.mode === 'resize' ? '#ff9800' : 'none')
                          : (hoveredResizeId === maskObj.id ? '#2196f3' : 'none')
                      }
                      transform="rotate(14 13 54)"
                      style={{
                        transition: 'fill 0.25s cubic-bezier(.4,2,.6,1)',
                      }}
                    />
                  </g>
                </svg>
              </span>
            </div>
            <button
              disabled={isPending}
              onPointerDown={async (e) => {
                e.stopPropagation();
                // Find the mask being deleted
                const deletedMask = maskObj;

                setMasks(prev => {
                  const newMasks = prev.filter(m => m.id !== maskObj.id);
                  // Find the mask under the deleted one with the largest overlap area
                  let maskA = typeof deletedMask.mask === 'string' ? JSON.parse(deletedMask.mask) : deletedMask.mask;
                  let maxOverlap = 0;
                  let mostOverlapping: typeof maskObj | undefined;
                  for (const m of newMasks) {
                    let maskB = typeof m.mask === 'string' ? JSON.parse(m.mask) : m.mask;
                    const x_overlap = Math.max(0, Math.min(maskA.x + maskA.w, maskB.x + maskB.w) - Math.max(maskA.x, maskB.x));
                    const y_overlap = Math.max(0, Math.min(maskA.y + maskA.h, maskB.y + maskB.h) - Math.max(maskA.y, maskB.y));
                    const overlapArea = x_overlap * y_overlap;
                    if (overlapArea > maxOverlap) {
                      maxOverlap = overlapArea;
                      mostOverlapping = m;
                    }
                  }
                  if (mostOverlapping) {
                    const mask = typeof mostOverlapping.mask === 'string' ? JSON.parse(mostOverlapping.mask) : mostOverlapping.mask;
                    // Use the last drag offset from the deleted mask if available
                    const lastOffset = lastDragOffsetRef.current[deletedMask.id];
                    setDragging({
                      id: mostOverlapping.id,
                      mode: 'move',
                      offsetX: lastOffset?.offsetX ?? 0,
                      offsetY: lastOffset?.offsetY ?? 0,
                      origX: mask.x,
                      origY: mask.y,
                      origW: mask.w,
                      origH: mask.h
                    });
                    if (setIsDraggingMask) setIsDraggingMask(true);
                  }
                  return newMasks;
                });
                // After any mask API update:
                pauseMaskPollingUntil.current = Date.now() + 1000; // Pause for 1 second
                await authFetch(`/api/masks/${maskObj.streamId}/${maskObj.id}`, {
                  method: 'DELETE',
                  headers: { 'Content-Type': 'application/json' }
                });
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
                opacity: (hoveredMaskId === maskObj.id || (isDragging && dragging.id === maskObj.id)) ? 0.96 : 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.2s, opacity 0.35s cubic-bezier(.4,2,.6,1), transform 0.35s cubic-bezier(.4,2,.6,1)',
                outline: 'none',
                padding: 0,
                pointerEvents: isPending
                  ? 'none'
                  : (hoveredMaskId === maskObj.id || (isDragging && dragging.id === maskObj.id))
                    ? 'auto'
                    : 'none',
                transform:
                  (hoveredMaskId === maskObj.id || (isDragging && dragging.id === maskObj.id))
                    ? 'scale(1)'
                    : 'scale(0.2)',
              }}
              title="Delete mask"
            >
              {/* Trash can icon */}
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none">
                <path d="M7 10v7M12 10v7M17 10v7" stroke="#fff" strokeWidth="2" strokeLinecap="round" />
                <rect x="5" y="7" width="14" height="13" rx="2" stroke="#fff" strokeWidth="2" fill="none" />
                <rect x="9" y="3" width="6" height="3" rx="1.5" fill="#fff" />
                <rect x="3" y="6" width="18" height="2" rx="1" fill="#fff" />
              </svg>
            </button>

            {/* Settings Cog */}
            <span
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
                opacity: (hoveredMaskId === maskObj.id || (isDragging && dragging.id === maskObj.id)) ? 0.96 : 0,
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                transition: 'background 0.2s, opacity 0.35s cubic-bezier(.4,2,.6,1), transform 0.35s cubic-bezier(.4,2,.6,1)',
                outline: 'none',
                padding: 0,
                pointerEvents: isPending
                  ? 'none'
                  : (hoveredMaskId === maskObj.id || (isDragging && dragging.id === maskObj.id))
                    ? 'auto'
                    : 'none',
                transform:
                  (hoveredMaskId === maskObj.id || (isDragging && dragging.id === maskObj.id))
                    ? 'scale(1)'
                    : 'scale(0.2)',
              }}
              onPointerDown={e => {
                e.stopPropagation();
                setSettingsOpenId(maskObj.id);
                // Position popout near cog
                const rect = (e.target as HTMLElement).getBoundingClientRect();
                setSettingsAnchor({ x: rect.left + rect.width / 2, y: rect.bottom });
              }}
              title="Mask settings"
            >
              {/* Cog SVG */}
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none">
                <circle cx="10" cy="10" r="7" stroke="#2196f3" strokeWidth="2" fill="#fff" />
                <path d="M10 5v2M10 13v2M5 10h2M13 10h2M7.5 7.5l1 1M11.5 11.5l1 1M7.5 12.5l1-1M11.5 8.5l1-1" stroke="#2196f3" strokeWidth="1.2" strokeLinecap="round" />
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
                }}
                onPointerDown={e => e.stopPropagation()}
              >
                <div style={{ fontWeight: 600, marginBottom: 8 }}>Disable on</div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', marginBottom: 4 }}>
                  <input
                    type="checkbox"
                    checked={maskObj.type === 'conditional'}
                    onChange={async (e) => {
                      const newType = e.target.checked ? 'conditional' : 'fixed';
                      setMasks(prev =>
                        prev.map(m =>
                          m.id === maskObj.id ? { ...m, type: newType } : m
                        )
                      );
                      setSettingsOpenId(null);
                      // API update using PATCH
                      await authFetch(`/api/masks/${maskObj.streamId}/${maskObj.id}`, {
                        method: 'PATCH',
                        headers: { 'Content-Type': 'application/json' },
                        body: JSON.stringify({ mask: { ...mask, type: newType } }),
                      });
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
                  onClick={() => setSettingsOpenId(null)}
                >
                  Close
                </button>
              </div>
            )}

            {/* Pending update spinner/tap to edit text */}
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
            <span
              style={{
                position: 'absolute',
                left: '50%',
                top: '50%',
                transform: (
                  (hoveredMaskId === maskObj.id && hoveredResizeId !== maskObj.id) ||
                  (isDragging && dragging?.mode === 'move')
                )
                  ? 'translate(-50%, -190%)'
                  : 'translate(-50%, -50%)',
                color: '#2196f3',
                fontWeight: 700,
                fontSize: Math.max(16, dragPos.h * scaleY * 0.15),
                textShadow: '0 2px 8px rgba(0,0,0,0.35)',
                pointerEvents: 'none',
                zIndex: 10,
                transition:
                  'transform 0.35s cubic-bezier(.4,2,.6,1), opacity 0.25s cubic-bezier(.4,2,.6,1)',
                opacity: isDragging || maskObj.pendingUpdate ? 0 : 1,
                userSelect: 'none',
                whiteSpace: 'nowrap',
              }}
            >
              {'ontouchstart' in window ? 'Tap to edit' : 'Click to edit'}
            </span>
          </div>
        );
      })}
    </div>
  );
};
