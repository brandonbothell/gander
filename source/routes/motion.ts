import { persistStreamState, prisma, safeUnlinkWithRetry, StreamMotionState } from "../camera";
import { logMotion } from '../logMotion';
import { jwtAuth } from "../middleware/jwtAuth";
import express, { Express } from "express";
import { clearMotionHistory } from "../motionDetector";
import { StreamManager } from "../streamManager";
import * as fs from "fs";
import path from "path";
import { exec } from "child_process";
import { notify } from "./notifications";

export default function initializeMotionRoutes(
  app: Express,
  streamStates: Record<string, StreamMotionState>,
  dynamicStreams: Record<string, StreamManager>
) {
  // --- Motion status ---
  app.get('/api/motion-status', jwtAuth, (req, res) => {
    const states: { [streamId: string]: { recording: boolean, secondsLeft: number, saving: boolean, startedRecordingAt: number } } = {};
    for (const streamId in streamStates) {
      const state = streamStates[streamId];
      if (!state) {
        states[streamId] = { recording: false, secondsLeft: 0, saving: false, startedRecordingAt: 0 };
        continue;
      }
      let secondsLeft = 0;
      if (state.motionRecordingActive && state.motionRecordingTimeoutAt) {
        secondsLeft = Math.max(0, Math.ceil((state.motionRecordingTimeoutAt - Date.now()) / 1000));
      }
      states[streamId] = {
        recording: state.motionRecordingActive,
        secondsLeft,
        saving: state.savingInProgress || false,
        startedRecordingAt: state.startedRecordingAt
      };
    }
    res.json(states);
  });

  // --- Get or set motion pause state ---
  app.get('/api/motion-pause', jwtAuth, (_, res) => {
    res.json(Object.fromEntries(Object.entries(streamStates).map(([streamId, state]) => [streamId, state.motionPaused])));
  });

  app.post('/api/motion-pause/:streamId', jwtAuth, express.json(), async (req, res) => {
    const { streamId } = req.params;
    const state = streamStates[streamId];
    if (!state) { res.status(404).json({ paused: false }); return; }

    state.motionPaused = !!req.body.paused;
    clearMotionHistory(streamId); // <-- clear motion/movement history
    await persistStreamState(streamId); // <-- persist to DB

    const { nickname } = await prisma.stream.findUnique({
      where: { id: streamId },
      select: { nickname: true }
    }) || { nickname: dynamicStreams[streamId].config.ffmpegInput };

    if (state.motionPaused) {
      // Cancel any ongoing save operation
      if (state.savingInProgress && state.currentSaveProcess) {
        logMotion(`[${streamId}] Pausing motion - canceling ongoing save operation`);
        state.currentSaveProcess.kill('SIGTERM');
        state.savingInProgress = false;
        state.currentSaveProcess = null;
        state.saveRetryCount = 0;
      }

      if (state.motionRecordingActive) {
        if (state.motionTimeout) clearTimeout(state.motionTimeout);
        // Save any pending segments before pausing
        if (state.motionSegments.length > 0) {
          saveMotionSegmentsWithRetry(streamStates, dynamicStreams, streamId).then(() => {
            state.notificationSent = false;
            state.motionRecordingActive = false;
            state.motionRecordingTimeoutAt = 0;
          });
        }
      }

      await notify(dynamicStreams, streamId, {
        title: 'Motion Recording Paused',
        body: `Motion recording has been paused for ${nickname}.`,
        icon: 'push_icon',
        sound: 'default',
        channelId: 'motion_event_low_channel',
        tag: 'motion_pause'
      });
    } else {
      await notify(dynamicStreams, streamId, {
        title: 'Motion Recording Resumed',
        body: `Motion recording has been resumed for ${nickname}.`,
        icon: 'push_icon',
        sound: 'default',
        channelId: 'motion_event_low_channel',
        tag: 'motion_pause'
      });
    }

    res.json({ paused: state.motionPaused });
  });
}

// Enhanced save function with retry logic
export async function saveMotionSegmentsWithRetry(
  streamStates: Record<string, StreamMotionState>,
  dynamicStreams: Record<string, StreamManager>,
  streamId: string,
  retryAttempt: number = 0
): Promise<void> {
  const state = streamStates[streamId];
  const maxRetries = 2;

  try {
    await saveMotionSegments(streamStates, dynamicStreams, streamId);
    state.saveRetryCount = 0; // Reset retry count on success
  } catch (error) {
    logMotion(`[${streamId}] Motion save attempt ${retryAttempt + 1} failed: ${error}`);

    if (retryAttempt < maxRetries) {
      const delay = Math.min(1000 * Math.pow(2, retryAttempt), 5000); // Exponential backoff, max 5 seconds
      logMotion(`[${streamId}] Retrying save in ${delay}ms (attempt ${retryAttempt + 2}/${maxRetries + 1})`);

      setTimeout(() => {
        saveMotionSegmentsWithRetry(streamStates, dynamicStreams, streamId, retryAttempt + 1);
      }, delay);
    } else {
      logMotion(`[${streamId}] Failed to save motion segments after ${maxRetries + 1} attempts, giving up`);
      // Reset state even on failure
      state.savingInProgress = false;
      state.currentSaveProcess = null;
      state.saveRetryCount = 0;
      state.motionSegments = [];
    }
  }
}

async function saveMotionSegments(
  streamStates: Record<string, StreamMotionState>,
  dynamicStreams: Record<string, StreamManager>,
  streamId: string
): Promise<void> {
  const state = streamStates[streamId];
  const stream = dynamicStreams[streamId];

  if (state.motionSegments.length === 0) return;

  // Mark as saving in progress
  state.savingInProgress = true;

  const uniqueSegments = [...new Set(state.motionSegments)];

  // Filter out segments that no longer exist
  const existingSegmentsPromises = uniqueSegments.map(async segmentPath => {
    // logMotion(`[${streamId}] Segment no longer exists, skipping: ${path.basename(segmentPath)}`);
    return { segmentPath, exists: await fs.promises.access(segmentPath).then(() => true).catch(() => false) };
  });

  const existingSegments = (await Promise.all(existingSegmentsPromises)).filter(seg => seg.exists);

  if (existingSegments.length === 0) {
    logMotion(`[${streamId}] No existing segments to save, aborting save operation`);
    state.savingInProgress = false;
    state.motionSegments = []; // Clear segments even if no existing segments
    return;
  }

  const listFile = path.join(stream.config.hlsDir, 'concat_list.txt');

  try {
    // Ensure HLS directory exists before writing concat list
    await fs.promises.access(stream.config.hlsDir);
  } catch {
    logMotion(`[${streamId}] HLS directory no longer exists, cannot save segments`);
    state.savingInProgress = false;
    state.motionSegments = [];
    return;
  }

  try {
    await fs.promises.writeFile(listFile, existingSegments.map(seg => `file '${seg.segmentPath.replace(/\\/g, '/')}'`).join('\n'));
  } catch (error) {
    state.savingInProgress = false;
    state.motionSegments = []; // Clear segments on error too
    throw new Error(`Failed to write concat list: ${error}`);
  }

  const outFile = path.join(stream.config.recordDir, `motion_${new Date().toISOString().replace(/[:.]/g, '-')}.mp4`);
  const thumbFile = path.join(stream.config.thumbDir, path.basename(outFile).replace(/\.mp4$/, '.jpg'));
  const ffmpegConcatCmd = `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${outFile}"`;

  logMotion(`[${streamId}] Starting save of ${existingSegments.length} segments to ${path.basename(outFile)}`);

  const ffmpegProcess = exec(ffmpegConcatCmd, async (err) => {
    // Check if process was killed (canceled due to new motion)
    if (ffmpegProcess.killed) {
      logMotion(`[${streamId}] Save operation was canceled due to new motion detection`);
      state.savingInProgress = false;
      state.currentSaveProcess = null;
      await safeUnlinkWithRetry(listFile);
      // Don't clear motionSegments since we want to keep them for continued recording
      return; // Don't reject since cancellation is expected behavior
    }

    if (err) {
      logMotion(`[${streamId}] FFmpeg concat failed: ${err}`);
      state.savingInProgress = false;
      state.currentSaveProcess = null;
      state.motionSegments = []; // Clear segments on error
      await safeUnlinkWithRetry(listFile);
      throw err;
    }

    // Generate thumbnail
    let seek = 7; // Default seek time for thumbnail
    const thumbProcess = exec(`ffmpeg -y -i "${outFile}" -ss ${seek.toFixed(2)} -vframes 1 -update 1 "${thumbFile}"`, async (thumbErr) => {
      // Clean up segments that are no longer needed
      const promises = existingSegments.map(seg => {
        if (!state.recentSegments.includes(seg.segmentPath)) {
          return safeUnlinkWithRetry(seg.segmentPath);
        }
      });
      promises.push(safeUnlinkWithRetry(listFile))
      await Promise.all(promises);

      // ALWAYS clear motionSegments after successful save, regardless of recording state
      // This prevents the segments from being saved again on exit
      logMotion(`[${streamId}] Clearing ${state.motionSegments.length} saved segments from state`);
      state.motionSegments = [];

      state.savingInProgress = false;
      state.currentSaveProcess = null;

      // --- Save to MotionRecording table ---
      try {
        const duration = await getVideoDuration(outFile);
        const filename = path.basename(outFile);
        const recordedAt = filename.match(/(\d{4}-\d{2}-\d{2})T/)?.[1] || new Date().toISOString().slice(0, 10);

        await prisma.motionRecording.upsert({
          where: { streamId_filename: { streamId, filename } },
          update: { duration, updatedAt: new Date() },
          create: {
            streamId,
            filename,
            duration,
            recordedAt,
            updatedAt: new Date(),
          }
        });

        logMotion(`[${streamId}] Successfully saved ${filename} (${duration}s, ${existingSegments.length} segments)`);
      } catch (e) {
        logMotion(`[${streamId}] Failed to upsert MotionRecording: ${e}`);
      }

      return;
    });

    // Store thumbnail process as well for potential cancellation
    state.currentSaveProcess = thumbProcess;
  });

  // Store the process for potential cancellation
  state.currentSaveProcess = ffmpegProcess;

  // Add timeout for the save operation (in case it hangs)
  const saveTimeout = setTimeout(() => {
    if (state.currentSaveProcess && !state.currentSaveProcess.killed) {
      logMotion(`[${streamId}] Save operation timed out, killing process`);
      state.currentSaveProcess.kill('SIGTERM');
    }
  }, 60000); // 60 second timeout

  // Clear timeout when process completes
  ffmpegProcess.on('exit', () => {
    clearTimeout(saveTimeout);
  });
}

async function getVideoDuration(filePath: string): Promise<number> {
  const cmd = `ffprobe -v error -show_entries format=duration -of default=noprint_wrappers=1:nokey=1 "${filePath}"`;
  return new Promise((resolve) => {
    exec(cmd, (err, output) => {
      if (err) {
        console.error(`Failed to get duration for ${filePath}:`, err);
        return resolve(0);
      }
      resolve(Math.round(Number(output)));
    });
  });
}
