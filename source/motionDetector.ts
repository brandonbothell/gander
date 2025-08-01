/**
 * Motion detection module for video streams.
 * Heavily optimized for Raspberry Pi 4 with FFmpeg 5.1.6
 */

import { Jimp, diff as getDiff } from 'jimp';
import fs from 'fs';
import path from 'path';
import { spawn } from 'child_process';
import { prisma, StreamMotionState } from './camera';
import { logMotion } from './logMotion';
import { StreamManager } from './streamManager';

const STANDARD_WIDTH = 160;   // Much smaller for performance
const STANDARD_HEIGHT = 90;

// Debug logging
export function debugLog(message: string) {
  const DEBUG_MOTION = process.env.DEBUG_MOTION === 'true';
  if (DEBUG_MOTION) {
    logMotion(message);
  }
}

let lastFrame: { [streamId: string]: Awaited<ReturnType<typeof Jimp.read>> } = {};
let streamMotionHistory: { [streamId: string]: boolean[] } = {};
let streamMovementHistory: { [streamId: string]: boolean[] } = {};

const streamMotionThresholds = {
  min: 0.002, max: 0.4, // Slightly higher due to lower resolution
};

// Adjusted for 0.5-second segments instead of 2-second segments
const GLOBAL_HISTORY_LENGTH = 4;  // Keep same for now
const CAMERA_MOVEMENT_HISTORY_LENGTH = 6; // Keep same for now

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

    // Quick estimation based on segment duration (0.5 seconds at ~20fps = ~10 frames)
    const estimatedFrames = 10; // Reasonable estimate for 0.5-second segments
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
  delete lastFrame[streamId];
  delete firstFrameSaved[streamId];
}

// Limit concurrent FFmpeg frame extractions
const MAX_CONCURRENT_FFMPEG = 3;
let runningFfmpeg = 0;
const ffmpegQueue: Array<() => void> = [];

function runFfmpegTask(task: () => Promise<void>): Promise<void> {
  return new Promise((resolve, reject) => {
    const run = async () => {
      if (runningFfmpeg >= MAX_CONCURRENT_FFMPEG) {
        ffmpegQueue.push(run);
        return;
      }
      runningFfmpeg++;
      try {
        await task();
        resolve();
      } catch (e) {
        reject(e);
      } finally {
        runningFfmpeg--;
        if (ffmpegQueue.length > 0) {
          const next = ffmpegQueue.shift();
          if (next) next();
        }
      }
    };
    run();
  });
}

// Simplified frame extraction for very short segments
function extractFrame(segmentPath: string, outputPath: string): Promise<void> {
  return runFfmpegTask(() => new Promise((resolve, reject) => {
    debugLog(`[Motion] Extracting frame from ${segmentPath} to ${outputPath}`);

    // Check if segmentPath exists before spawning ffmpeg
    fs.promises.stat(segmentPath).then(stats => {
      if (stats.size < 1000) {
        logMotion(`[Motion] Segment file too small: ${segmentPath}`, 'warn');
        reject(new Error('Segment file too small'));
        return;
      }

      // For 0.5-second segments, don't seek at all - just grab the first frame
      const ffmpeg = spawn('ffmpeg', [
        '-y',
        '-i', segmentPath,
        '-vf', `scale=${STANDARD_WIDTH}:${STANDARD_HEIGHT}`,
        '-vframes', '1',
        '-update', '1',
        '-q:v', '5',  // Better quality
        '-f', 'image2',
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
      }, 10000); // Increased to 10 seconds

      ffmpeg.on('close', (code) => {
        clearTimeout(timeout);
        // Small delay for file system sync
        setTimeout(async () => {
          if (code === 0) {
            // Check if file exists and has content
            try {
              const stats = await fs.promises.stat(outputPath);
              if (stats.size > 100) {
                debugLog(`[Motion] Successfully extracted frame (${stats.size} bytes)`);
                resolve();
              } else {
                logMotion(`[Motion] Frame file too small (${stats.size} bytes), retrying with PNG`, 'warn');
                // Try PNG format instead
                const pngPath = outputPath.replace('.jpg', '.png');
                const pngFfmpeg = spawn('ffmpeg', [
                  '-y',
                  '-i', segmentPath,
                  '-vf', `scale=${STANDARD_WIDTH}:${STANDARD_HEIGHT}`,
                  '-vframes', '1',
                  '-update', '1',
                  '-f', 'image2',
                  pngPath
                ], {
                  stdio: ['ignore', 'ignore', 'pipe']
                });

                const pngTimeout = setTimeout(() => {
                  pngFfmpeg.kill('SIGKILL');
                  reject(new Error('PNG frame extraction timeout'));
                }, 10000);

                pngFfmpeg.on('close', async (pngCode) => {
                  clearTimeout(pngTimeout);
                  try {
                    if (pngCode === 0 && (await fs.promises.stat(pngPath)).size > 100) {
                      try {
                        await fs.promises.rename(pngPath, outputPath);
                        debugLog(`[Motion] PNG extraction successful, renamed to JPG`);
                        resolve();
                      } catch (e) {
                        logMotion(`[Motion] PNG extraction successful but rename failed`, 'error');
                        reject(new Error('Rename failed'));
                      }
                    } else {
                      logMotion(`Both JPG and PNG extraction failed`, 'error');
                      reject(new Error('Both formats failed'));
                    }
                  }
                  catch {
                    logMotion(`Both JPG and PNG extraction failed`, 'error');
                    reject(new Error('Both formats failed'));
                  }
                });

                pngFfmpeg.on('error', (err) => {
                  clearTimeout(pngTimeout);
                  logMotion(`[Motion] PNG FFmpeg spawn error: ${err}`, 'error');
                  reject(err);
                });
              }
            } catch {
              logMotion(`[Motion] No output file found at ${outputPath} after FFmpeg success`, 'error');
              // List directory to debug
              const DEBUG_MOTION = process.env.DEBUG_MOTION === 'true';
              if (DEBUG_MOTION) {
                try {
                  const dir = path.dirname(outputPath);
                  const files = await fs.promises.readdir(dir);
                  debugLog(`[Motion] Directory contents: ${files.slice(0, 10).join(', ')}${files.length > 10 ? '...' : ''}`);
                } catch (e) {
                  debugLog(`[Motion] Could not list directory: ${e}`);
                }
              }
              reject(new Error('No output file'));
            }
          } else {
            logMotion(`[Motion] FFmpeg failed with code ${code}: ${errorOutput}`, 'error');
            reject(new Error(`FFmpeg failed with code ${code}`));
          }
        }, 50); // 50ms delay
      });

      ffmpeg.on('error', (err) => {
        clearTimeout(timeout);
        logMotion(`[Motion] FFmpeg spawn error: ${err}`, 'error');
        reject(err);
      });
    }).catch(() => {
      logMotion(`[Motion] Segment file missing: ${segmentPath}`, 'error');
      reject(new Error(`Segment file missing: ${segmentPath}`));
    });
  }));
}

export async function detectMotion(streamStates: Record<string, StreamMotionState>,
  streamId: string,
  segmentPath: string,
  diffThreshold = streamMotionThresholds.min ?? 0.002,
  cameraMovementThreshold = streamMotionThresholds.max ?? 0.4,
): Promise<{ motion: boolean; aboveCameraMovementThreshold: boolean }> {
  debugLog(`[${streamId}] [Motion] Starting detection for ${segmentPath}`);

  const state = streamStates[streamId];

  if (!state || state.cleaningUp) {
    logMotion(`[${streamId}] Skipping flush/frame extraction during cleanup`, 'warn');
    return { motion: false, aboveCameraMovementThreshold: false };
  }

  try {
    // Quick file existence check
    try {
      const stat = await fs.promises.stat(segmentPath);
      if (stat.size < 1000) {
        logMotion(`[${streamId}] [Motion] Segment file too small: ${segmentPath}`, 'warn');
        return { motion: false, aboveCameraMovementThreshold: false };
      }
    } catch (err) {
      logMotion(`[${streamId}] [Motion] Segment file missing: ${segmentPath}`, 'error');
      return { motion: false, aboveCameraMovementThreshold: false };
    }

    // Use absolute path construction for Windows
    const segmentDir = path.dirname(segmentPath);
    const segmentName = path.basename(segmentPath, '.ts');
    const framePath = path.join(segmentDir, `${segmentName}_motion.jpg`);

    debugLog(`[${streamId}] [Motion] Expected frame path: ${framePath}`);

    try {
      await extractFrame(segmentPath, framePath);
    } catch (error) {
      logMotion(`[${streamId}] Failed to extract frame from ${segmentPath}: ${error}`, 'error');
      return { motion: false, aboveCameraMovementThreshold: false };
    }

    // Check if framePath exists
    let frameExists = false;
    try {
      frameExists = await fs.promises.stat(framePath).then(() => true).catch(() => false);
    } catch {
      frameExists = false;
    }
    if (!frameExists) {
      logMotion(`[${streamId}] [Motion] Frame extraction failed - no output file at ${framePath}`, 'error');
      return { motion: false, aboveCameraMovementThreshold: false };
    }

    let motionDetected = false;
    let aboveCameraMovementThreshold = false;

    try {
      const currentFrame = await Jimp.read(framePath);
      debugLog(`[${streamId}] [Motion] Successfully loaded frame ${currentFrame.bitmap.width}x${currentFrame.bitmap.height}`);

      // Resize if needed (sometimes FFmpeg doesn't scale properly)
      if (currentFrame.bitmap.width !== STANDARD_WIDTH || currentFrame.bitmap.height !== STANDARD_HEIGHT) {
        currentFrame.resize({ w: STANDARD_WIDTH, h: STANDARD_HEIGHT });
      }

      // Aggressive preprocessing for speed
      currentFrame.greyscale();

      // Apply masks efficiently
      const masks = await getMasksForStream(streamId);
      if (masks.length > 0) {
        debugLog(`[${streamId}] [Motion] Applying ${masks.length} masks`);
      }

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
        debugLog(`[${streamId}] [Motion] Saved first frame for debugging`);
      }

      if (lastFrame[streamId]) {
        const diff = getDiff(lastFrame[streamId], currentFrame);
        const diffPercent = diff.percent;

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

        // Detection logic
        const movementCount = streamMovementHistory[streamId].filter(Boolean).length;
        const motionCount = streamMotionHistory[streamId].filter(Boolean).length;

        // More responsive detection with 0.5s segments
        motionDetected =
          (streamMovementHistory[streamId].length === CAMERA_MOVEMENT_HISTORY_LENGTH && movementCount >= 4) ||
          (streamMotionHistory[streamId].length === GLOBAL_HISTORY_LENGTH && motionCount >= 2);

        // Log motion detection results - always show actual motion, debug for all attempts
        if (motionDetected || diffPercent > 0.02) {
          logMotion(`[${streamId}] diff=${(diffPercent * 100).toFixed(2)}% motion=${motionDetected} threshold=${isAboveDiffThreshold} camMove=${aboveCameraMovementThreshold} (mov:${movementCount}/${streamMovementHistory[streamId].length}, mot:${motionCount}/${streamMotionHistory[streamId].length})`);
        } else {
          debugLog(`[${streamId}] [Motion] diff=${(diffPercent * 100).toFixed(2)}% motion=${motionDetected} threshold=${isAboveDiffThreshold} camMove=${aboveCameraMovementThreshold} (mov:${movementCount}/${streamMovementHistory[streamId].length}, mot:${motionCount}/${streamMotionHistory[streamId].length})`);
        }
      } else {
        debugLog(`[${streamId}] [Motion] No previous frame - storing first frame`);
      }

      lastFrame[streamId] = currentFrame;
    } catch (error) {
      logMotion(`[${streamId}] Error processing frame: ${error}`, 'error');
    }

    return {
      motion: motionDetected,
      aboveCameraMovementThreshold
    };

  } catch (error) {
    logMotion(`[${streamId}] Motion detection failed: ${error}`, 'error');
    return {
      motion: false,
      aboveCameraMovementThreshold: false
    };
  }
}

let cleanFrameCacheRunning = false;
export function cleanFrameCache(dynamicStreams: Record<string, StreamManager>, streamStates: Record<string, StreamMotionState>) {
  if (cleanFrameCacheRunning) {
    // Prevent overlapping runs
    return;
  }
  cleanFrameCacheRunning = true;
  const start = Date.now();
  for (const streamId in dynamicStreams) {
    const stream = dynamicStreams[streamId];
    if (streamStates[streamId]?.motionPaused) continue;

    fs.readdir(stream.config.hlsDir, async (err, files) => {
      if (err) { console.error(`[${streamId}] Error reading HLS directory: ${err}`); return; }
      // Clean up frame file
      const motionJpgs = files
        .filter(f => /^segment_(\d+)_motion\.jpg$/.test(f))
        .sort((a, b) => {
          const aNum = parseInt(a.match(/^segment_(\d+)_motion\.jpg$/)![1], 10);
          const bNum = parseInt(b.match(/^segment_(\d+)_motion\.jpg$/)![1], 10);
          return bNum - aNum;
        });
      motionJpgs.shift(); // Keep the latest one

      if (motionJpgs?.length > 0) {
        logMotion(`[${streamId}] Deleting old motion frames: ${motionJpgs.join(', ')}`);
        const toDelete = motionJpgs.map(f => path.join(stream.config.hlsDir, f));
        safeUnlink(...toDelete);
      }
    });
  }
  const elapsed = Date.now() - start;
  if (elapsed > 500) {
    debugLog(`[cleanFrameCache] Took ${elapsed}ms`);
  }
  cleanFrameCacheRunning = false;
}

// --- Async safeUnlink ---
export async function safeUnlink(...filePaths: string[]) {
  try {
    for (const filePath of filePaths) {
      await fs.promises.rm(filePath, { force: true, recursive: true }).catch(() => false);
    }
  } catch (error) {
    // Ignore errors silently for performance
  }
}
