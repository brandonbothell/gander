/**
 * Motion detection module for video streams.
 * Heavily optimized for Raspberry Pi 4 with FFmpeg 5.1.6
 */

import { Jimp, diff as getDiff } from 'jimp';
import fs from 'fs';
import { spawn } from 'child_process';
import { prisma } from './camera';

const STANDARD_WIDTH = 160;   // Much smaller for performance
const STANDARD_HEIGHT = 90;

let lastFrame: { [streamId: string]: Awaited<ReturnType<typeof Jimp.read>> } = {};
let streamMotionHistory: { [streamId: string]: boolean[] } = {};
let streamMovementHistory: { [streamId: string]: boolean[] } = {};

const streamMotionThresholds = {
  min: 0.002, max: 0.4, // Slightly higher due to lower resolution
};

const GLOBAL_HISTORY_LENGTH = 4;  // Reduced for faster response
const CAMERA_MOVEMENT_HISTORY_LENGTH = 6; // Reduced

// Cache frame counts to avoid repeated ffprobe calls
const frameCountCache: { [segmentPath: string]: { count: number, timestamp: number } } = {};
const FRAME_COUNT_CACHE_TTL = 5000;

function getFrameCount(segmentPath: string): Promise<number> {
  return new Promise((resolve) => {
    // Check cache first
    const cached = frameCountCache[segmentPath];
    const now = Date.now();
    if (cached && (now - cached.timestamp) < FRAME_COUNT_CACHE_TTL) {
      resolve(cached.count);
      return;
    }

    // Quick estimation based on segment duration (usually 2 seconds at ~25fps = ~50 frames)
    // This avoids the expensive ffprobe call in most cases
    const estimatedFrames = 25; // Reasonable estimate for 2-second segments
    frameCountCache[segmentPath] = { count: estimatedFrames, timestamp: now };
    resolve(estimatedFrames);
  });
}

let firstFrameSaved: { [streamId: string]: boolean } = {};

const maskCache: { [streamId: string]: { masks: Array<{ x: number, y: number, w: number, h: number }>, ts: number } } = {};
const MASK_CACHE_TTL = 10000; // Longer cache

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

// Highly optimized frame extraction for Pi 4
function extractFrame(segmentPath: string, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-y',
      '-ss', '1',  // Seek to middle of segment for consistent frames
      '-i', segmentPath,
      '-vf', `scale=${STANDARD_WIDTH}:${STANDARD_HEIGHT}`,
      '-vframes', '1',
      '-update', '1',
      '-q:v', '8',          // Better quality for compatibility
      '-pix_fmt', 'yuvj420p', // MJPEG compatible pixel format
      '-f', 'image2',       // Explicit format
      outputPath
    ], {
      stdio: ['ignore', 'ignore', 'pipe']
    });

    let errorOutput = '';
    ffmpeg.stderr?.on('data', (data) => {
      errorOutput += data.toString();
    });

    const timeout = setTimeout(() => {
      ffmpeg.kill('SIGKILL');
      reject(new Error('Frame extraction timeout'));
    }, 5000); // Increased timeout

    ffmpeg.on('close', (code) => {
      clearTimeout(timeout);
      if (code === 0) {
        resolve();
      } else {
        // Log the full error for debugging
        console.error(`[Motion] FFmpeg extraction error (code ${code}):`, errorOutput);
        reject(new Error(`FFmpeg failed with code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      clearTimeout(timeout);
      reject(err);
    });
  });
}

export async function detectMotion(
  streamId: string,
  segmentPath: string,
  diffThreshold = streamMotionThresholds.min ?? 0.002,
  cameraMovementThreshold = streamMotionThresholds.max ?? 0.4,
): Promise<{ motion: boolean; aboveCameraMovementThreshold: boolean }> {
  try {
    // Quick file existence check
    if (!fs.existsSync(segmentPath)) {
      return { motion: false, aboveCameraMovementThreshold: false };
    }

    // Extract single frame from middle of segment
    const framePath = segmentPath.replace(/\.ts$/, `_motion.jpg`);

    try {
      await extractFrame(segmentPath, framePath);
    } catch (error) {
      console.error(`[${streamId}] Failed to extract frame from ${segmentPath}:`, error);
      return { motion: false, aboveCameraMovementThreshold: false };
    }

    if (!fs.existsSync(framePath)) {
      return { motion: false, aboveCameraMovementThreshold: false };
    }

    let motionDetected = false;
    let aboveCameraMovementThreshold = false;

    try {
      const currentFrame = await Jimp.read(framePath);

      // Aggressive preprocessing for speed
      currentFrame.greyscale(); // Skip blur for performance

      // Apply masks efficiently
      const masks = await getMasksForStream(streamId);
      for (const region of masks) {
        // Simple rectangle fill - much faster than scan
        for (let y = region.y; y < region.y + region.h && y < STANDARD_HEIGHT; y++) {
          for (let x = region.x; x < region.x + region.w && x < STANDARD_WIDTH; x++) {
            const idx = (y * STANDARD_WIDTH + x) * 4;
            currentFrame.bitmap.data[idx] = 0;     // R
            currentFrame.bitmap.data[idx + 1] = 0; // G
            currentFrame.bitmap.data[idx + 2] = 0; // B
          }
        }
      }

      // Save first frame for debugging (once per stream)
      if (!firstFrameSaved[streamId]) {
        await currentFrame.write(`test_firstframe_${streamId}.jpg`);
        firstFrameSaved[streamId] = true;
      }

      if (lastFrame[streamId]) {
        const diff = getDiff(lastFrame[streamId], currentFrame);
        const diffPercent = diff.percent;

        const isAboveDiffThreshold = diffPercent > diffThreshold;
        aboveCameraMovementThreshold = diffPercent > cameraMovementThreshold;

        // Simplified motion history logic
        if (!streamMotionHistory[streamId]) streamMotionHistory[streamId] = [];
        const isMotion = isAboveDiffThreshold && !aboveCameraMovementThreshold;
        streamMotionHistory[streamId].push(isMotion);
        if (streamMotionHistory[streamId].length > GLOBAL_HISTORY_LENGTH) {
          streamMotionHistory[streamId].shift();
        }

        // Movement history logic
        if (!streamMovementHistory[streamId]) streamMovementHistory[streamId] = [];
        streamMovementHistory[streamId].push(isAboveDiffThreshold);
        if (streamMovementHistory[streamId].length > CAMERA_MOVEMENT_HISTORY_LENGTH) {
          streamMovementHistory[streamId].shift();
        }

        // Simplified detection logic: 4/6 movement OR 2/4 motion
        const movementCount = streamMovementHistory[streamId].filter(Boolean).length;
        let motionCount = 0;
        motionDetected = streamMovementHistory[streamId].length === CAMERA_MOVEMENT_HISTORY_LENGTH && movementCount >= 4;

        if (!motionDetected) {
          motionCount = streamMotionHistory[streamId].filter(Boolean).length;
          motionDetected = streamMotionHistory[streamId].length === GLOBAL_HISTORY_LENGTH && motionCount >= 2;
        }

        if (!motionDetected) {
          motionDetected = movementCount + motionCount > 6; // Combined logic
        }

        // Log only significant motion
        if (diffPercent > 0.02) {
          console.log(`[${streamId}] [Motion] diff=${(diffPercent * 100).toFixed(1)}% motion=${motionDetected}`);
        }
      }

      lastFrame[streamId] = currentFrame;
    } catch (error) {
      console.error(`[${streamId}] Error processing frame:`, error);
    }

    // Clean up frame file
    safeUnlink(framePath);

    return {
      motion: motionDetected,
      aboveCameraMovementThreshold
    };

  } catch (error) {
    console.error(`[${streamId}] Motion detection failed:`, error);
    return {
      motion: false,
      aboveCameraMovementThreshold: false
    };
  }
}

export function safeUnlink(filePath: string) {
  try {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  } catch (error) {
    console.warn(`Failed to delete file ${filePath}:`, error);
  }
}
