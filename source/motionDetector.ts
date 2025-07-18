/**
 * Motion detection module for video streams.
 * Optimized for Raspberry Pi 4 with FFmpeg 5.1.6
 */

import { Jimp, diff as getDiff } from 'jimp';
import fs from 'fs';
import { spawn } from 'child_process';
import { prisma } from './camera';

const STANDARD_WIDTH = 320;  // Reduced for Pi 4 performance
const STANDARD_HEIGHT = 180;
const FRAMES_PER_SEGMENT: number = 1;

let lastFrame: { [streamId: string]: Awaited<ReturnType<typeof Jimp.read>> } = {};
let streamMotionHistory: { [streamId: string]: boolean[] } = {};
let streamMovementHistory: { [streamId: string]: boolean[] } = {};

const streamMotionThresholds = {
  min: 0.001, max: 0.4,
};

const GLOBAL_HISTORY_LENGTH = 6;
const CAMERA_MOVEMENT_HISTORY_LENGTH = 9;

// Use spawn instead of execSync for better performance on Pi
function getFrameCount(segmentPath: string): Promise<number> {
  return new Promise((resolve) => {
    const ffprobe = spawn('ffprobe', [
      '-v', 'error',
      '-count_frames',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=nb_read_frames',
      '-of', 'default=nokey=1:noprint_wrappers=1',
      segmentPath
    ]);

    let output = '';
    ffprobe.stdout.on('data', (data) => {
      output += data.toString();
    });

    ffprobe.on('close', (code) => {
      if (code === 0) {
        const count = parseInt(output.trim(), 10);
        resolve(Math.max(1, isNaN(count) ? 1 : count));
      } else {
        resolve(1);
      }
    });

    ffprobe.on('error', () => {
      resolve(1);
    });
  });
}

let firstFrameSaved: { [streamId: string]: boolean } = {};

const maskCache: { [streamId: string]: { masks: Array<{ x: number, y: number, w: number, h: number }>, ts: number } } = {};
const MASK_CACHE_TTL = 5000;

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

// Optimized frame extraction for Pi 4
function extractFrame(segmentPath: string, frameIdx: number, outputPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const ffmpeg = spawn('ffmpeg', [
      '-y',
      '-i', segmentPath,
      '-vf', `select=eq(n\\,${frameIdx}),scale=${STANDARD_WIDTH}:${STANDARD_HEIGHT}`,
      '-vframes', '1',
      '-update', '1',  // Added -update flag
      '-q:v', '5',     // Higher compression for faster processing
      outputPath
    ], {
      stdio: ['ignore', 'ignore', 'pipe']
    });

    let errorOutput = '';
    ffmpeg.stderr?.on('data', (data) => {
      errorOutput += data.toString();
    });

    ffmpeg.on('close', (code) => {
      if (code === 0) {
        resolve();
      } else {
        console.error(`[Motion] FFmpeg frame extraction failed: ${errorOutput}`);
        reject(new Error(`FFmpeg failed with code ${code}`));
      }
    });

    ffmpeg.on('error', (err) => {
      console.error(`[Motion] FFmpeg spawn error:`, err);
      reject(err);
    });
  });
}

export async function detectMotion(
  streamId: string,
  segmentPath: string,
  diffThreshold = streamMotionThresholds.min ?? 0.01,
  cameraMovementThreshold = streamMotionThresholds.max ?? 0.2,
): Promise<{ motion: boolean; aboveCameraMovementThreshold: boolean }> {
  try {
    // 1. Get frame count
    const frameCount = await getFrameCount(segmentPath);

    // 2. Calculate frame indices
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

      try {
        await extractFrame(segmentPath, frameIdx, framePath);
      } catch (error) {
        console.error(`[${streamId}] Failed to extract frame ${i} from ${segmentPath}:`, error);
        framePaths.pop();
      }
    }

    let motionDetected = false;
    let aboveCameraMovementThreshold = false;
    const diffPercents: number[] = [];

    // 4. Process frames
    for (let i = 0; i < framePaths.length; i++) {
      const framePath = framePaths[i];
      if (!fs.existsSync(framePath)) continue;

      try {
        const currentFrame = await Jimp.read(framePath);

        // Preprocess - optimized for Pi 4
        currentFrame.greyscale().blur(1); // Reduced blur for performance

        // Fetch and apply masks from DB
        const masks = await getMasksForStream(streamId);
        for (const region of masks) {
          currentFrame.scan(region.x, region.y, region.w, region.h, function (xx, yy, idx) {
            currentFrame.bitmap.data[idx] = 0;
            currentFrame.bitmap.data[idx + 1] = 0;
            currentFrame.bitmap.data[idx + 2] = 0;
          });
        }

        // Save first frame for debugging
        if (!firstFrameSaved[streamId] && i === 0) {
          await currentFrame.write(`test_firstframe_${streamId}.jpg`);
          firstFrameSaved[streamId] = true;
        }

        let diff: { percent: number, image: any } = { percent: 0, image: null };

        if (lastFrame[streamId]) {
          diff = getDiff(lastFrame[streamId], currentFrame);
          const diffPercent = diff.percent;
          diffPercents.push(diffPercent);

          const isAboveDiffThreshold = diffPercent > diffThreshold;
          aboveCameraMovementThreshold = diffPercent > cameraMovementThreshold;

          // Motion history logic
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

          // 6/9 logic
          const movementCount = streamMovementHistory[streamId].filter(Boolean).length;
          motionDetected = streamMovementHistory[streamId].length === CAMERA_MOVEMENT_HISTORY_LENGTH && movementCount >= 6;

          // 3/6 logic
          if (!motionDetected) {
            const motionCount = streamMotionHistory[streamId].filter(Boolean).length;
            motionDetected = streamMotionHistory[streamId].length === GLOBAL_HISTORY_LENGTH && motionCount >= 3;
          }
        }

        lastFrame[streamId] = currentFrame;
      } catch (error) {
        console.error(`[${streamId}] Error processing frame ${framePath}:`, error);
      }

      // Clean up frame file
      safeUnlink(framePath);
    }

    // Log results
    if (diffPercents.length > 0) {
      const mean = diffPercents.reduce((a, b) => a + b, 0) / diffPercents.length;
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
