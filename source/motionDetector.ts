/**
 * Motion detection module for video streams.
 * This module uses Jimp for image processing and ffmpeg/ffprobe for video frame extraction.
 * It detects motion based on frame differences and applies masking to specific regions.
 */

import { Jimp, diff as getDiff } from 'jimp';
import fs from 'fs';
import { execSync } from 'child_process';
import { prisma } from './camera';

const STANDARD_WIDTH = 640;
const STANDARD_HEIGHT = 360; // Scalable dimensions for processing

const FRAMES_PER_SEGMENT: number = 1; // Scalable

let lastFrame: { [streamId: string]: Awaited<ReturnType<typeof Jimp.read>> } = {};
let streamMotionHistory: { [streamId: string]: boolean[] } = {};
let streamMovementHistory: { [streamId: string]: boolean[] } = {};

const streamMotionThresholds = {
  min: 0.001, max: 0.4,
};

// Use a global rolling history of diffs per stream (not reset per segment)
const GLOBAL_HISTORY_LENGTH = 6;
const CAMERA_MOVEMENT_HISTORY_LENGTH = 9; // 4/6 logic

function getFrameCount(segmentPath: string): number {
  try {
    const ffprobeCmd = `ffprobe -v error -count_frames -select_streams v:0 -show_entries stream=nb_read_frames -of default=nokey=1:noprint_wrappers=1 "${segmentPath}"`;
    const output = execSync(ffprobeCmd).toString().trim();
    return Math.max(1, parseInt(output, 10));
  } catch {
    return 1;
  }
}

// Top-level flag to ensure we only save the first frame once per process
let firstFrameSaved = false;

// Helper to fetch masks for a stream from the DB (cache for a few seconds for performance)
const maskCache: { [streamId: string]: { masks: Array<{ x: number, y: number, w: number, h: number }>, ts: number } } = {};
const MASK_CACHE_TTL = 5000; // ms

async function getMasksForStream(streamId: string): Promise<Array<{ x: number, y: number, w: number, h: number }>> {
  const now = Date.now();
  if (maskCache[streamId] && now - maskCache[streamId].ts < MASK_CACHE_TTL) {
    return maskCache[streamId].masks;
  }
  const dbMasks = await prisma.streamMask.findMany({ where: { streamId } });
  const masks = dbMasks.map(m => {
    try {
      return typeof m.mask === 'string' ? JSON.parse(m.mask) : m.mask;
    } catch {
      return null;
    }
  }).filter(Boolean) as Array<{ x: number, y: number, w: number, h: number }>;
  maskCache[streamId] = { masks, ts: now };
  return masks;
}

export function clearMotionHistory(streamId: string) {
  streamMotionHistory[streamId] = [];
  streamMovementHistory[streamId] = [];
}

export async function detectMotion(
  streamId: string,
  segmentPath: string,
  diffThreshold = streamMotionThresholds.min ?? 0.01,
  cameraMovementThreshold = streamMotionThresholds.max ?? 0.2,
): Promise<{ motion: boolean; aboveCameraMovementThreshold: boolean }> {
  // 1. Get frame count using ffprobe
  const frameCount = getFrameCount(segmentPath);

  // 2. Calculate frame indices (evenly spaced, clamped)
  const frameIndices: number[] = [];
  for (let i = 0; i < FRAMES_PER_SEGMENT; i++) {
    let idx = 0;
    if (FRAMES_PER_SEGMENT === 1) {
      idx = 0;
    } else {
      idx = Math.round((frameCount - 1) * i / (FRAMES_PER_SEGMENT - 1));
    }
    frameIndices.push(Math.min(idx, frameCount - 1));
  }

  // 3. Extract frames
  const framePaths: string[] = [];
  for (let i = 0; i < frameIndices.length; i++) {
    const frameIdx = frameIndices[i];
    const framePath = segmentPath.replace(/\.ts$/, `_f${i}.jpg`);
    framePaths.push(framePath);

    const ffmpegCmd = `ffmpeg -y -i "${segmentPath}" -vf "select=eq(n\\,${frameIdx}),scale=${STANDARD_WIDTH}:${STANDARD_HEIGHT}" -vframes 1 "${framePath}"`;

    try {
      await new Promise<void>((resolve, reject) => {
        require('child_process').exec(ffmpegCmd, (err: any) => {
          if (err) {
            console.error(`[${streamId}] FFmpeg frame extraction failed:`, err);
            reject(err);
          } else {
            resolve();
          }
        });
      });
    } catch (error) {
      console.error(`[${streamId}] Failed to extract frame ${i} from ${segmentPath}:`, error);
      // Remove this frame from processing list
      framePaths.pop();
    }
  }

  let motionDetected = false;
  let aboveCameraMovementThreshold = false;

  const diffPercents: number[] = [];

  for (let i = 0; i < framePaths.length; i++) {
    const framePath = framePaths[i];
    if (!fs.existsSync(framePath)) continue;
    const currentFrame = await Jimp.read(framePath);

    // Preprocess
    currentFrame.greyscale().blur(2);

    // Fetch and apply masks from DB
    const masks = await getMasksForStream(streamId);
    for (const region of masks) {
      currentFrame.scan(region.x, region.y, region.w, region.h, function (xx, yy, idx) {
        currentFrame.bitmap.data[idx] = 0;
        currentFrame.bitmap.data[idx + 1] = 0;
        currentFrame.bitmap.data[idx + 2] = 0;
      });
    }

    // Save the very first frame processed (once per process)
    if (!firstFrameSaved && i === 0) {
      await currentFrame.write(`test_firstframe_${streamId}.jpg`);
      firstFrameSaved = true;
    }

    let diff: { percent: number, image: any } = { percent: 0, image: null };

    if (lastFrame[streamId]) {
      diff = getDiff(lastFrame[streamId], currentFrame);
      const diffPercent = diff.percent;
      diffPercents.push(diffPercent);

      const isAboveDiffThreshold = diffPercent > diffThreshold;
      // Track if frame is above camera movement threshold
      aboveCameraMovementThreshold = diffPercent > cameraMovementThreshold

      // --- GLOBAL 3/6 logic to start motion (ignores camera movement) ---
      if (!streamMotionHistory[streamId]) streamMotionHistory[streamId] = [];
      const isMotion = isAboveDiffThreshold && !aboveCameraMovementThreshold;
      streamMotionHistory[streamId].push(isMotion);
      if (streamMotionHistory[streamId].length > GLOBAL_HISTORY_LENGTH) streamMotionHistory[streamId].shift();

      // --- GLOBAL 6/9 logic (for all movement) ---
      if (!streamMovementHistory[streamId]) streamMovementHistory[streamId] = [];
      streamMovementHistory[streamId].push(isAboveDiffThreshold);
      if (streamMovementHistory[streamId].length > CAMERA_MOVEMENT_HISTORY_LENGTH) streamMovementHistory[streamId].shift();

      // 6/9 logic
      const motionCount = streamMovementHistory[streamId].filter(Boolean).length;
      motionDetected = streamMovementHistory[streamId].length === CAMERA_MOVEMENT_HISTORY_LENGTH && motionCount >= 6;

      // 3/6 logic
      if (!motionDetected) {
        const motionCount = streamMotionHistory[streamId].filter(Boolean).length;
        motionDetected = streamMotionHistory[streamId].length === GLOBAL_HISTORY_LENGTH && motionCount >= 3;
      };
    }

    lastFrame[streamId] = currentFrame;
    safeUnlink(framePath);
  }

  // Log all diffs and mean after processing all frames
  if (diffPercents.length > 0) {
    const mean = diffPercents.reduce((a, b) => a + b, 0) / diffPercents.length
    if (mean > 0.01) {
      console.log(
        `[${streamId}] [Motion] diffs=[${diffPercents.map(p => (p * 100).toFixed(1)).join(', ')}]% mean=${(mean * 100).toFixed(2)}%`
      );
    }

  }

  return {
    motion: motionDetected,
    aboveCameraMovementThreshold
  };
}

export function safeUnlink(filePath: string) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    // Log the error but don't crash the process
    console.warn(`Failed to delete file ${filePath}:`, error);
  }
}
