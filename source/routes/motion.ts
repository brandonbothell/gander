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
        saving: state.savingInProgress ?? false,
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
            if (state.flushTimer) {
              clearInterval(state.flushTimer);
              state.flushTimer = undefined;
            }
          });
        }
      }

      await notify(dynamicStreams, streamId, {
        title: 'Motion Recording Paused',
        body: `Motion recording has been paused for ${nickname}.`,
        channelId: 'motion_event_low_channel',
        tag: `motion_pause_${streamId}`
      });
    } else {
      await notify(dynamicStreams, streamId, {
        title: 'Motion Recording Resumed',
        body: `Motion recording has been resumed for ${nickname}.`,
        channelId: 'motion_event_low_channel',
        tag: `motion_pause_${streamId}`
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

// --- Flush motion segments periodically ---
export async function flushMotionSegmentsWithRetry(
  streamStates: Record<string, StreamMotionState>,
  dynamicStreams: Record<string, StreamManager>,
  streamId: string,
  retryAttempt: number = 0
): Promise<void> {
  const state = streamStates[streamId];
  const maxRetries = 2;

  try {
    await flushMotionSegments(streamStates, dynamicStreams, streamId);
    state.saveRetryCount = 0;
  } catch (error) {
    logMotion(`[${streamId}] Motion flush attempt ${retryAttempt + 1} failed: ${error}`);

    if (retryAttempt < maxRetries) {
      const delay = Math.min(1000 * Math.pow(2, retryAttempt), 5000);
      logMotion(`[${streamId}] Retrying flush in ${delay}ms (attempt ${retryAttempt + 2}/${maxRetries + 1})`);
      setTimeout(() => {
        flushMotionSegmentsWithRetry(streamStates, dynamicStreams, streamId, retryAttempt + 1);
      }, delay);
    } else {
      logMotion(`[${streamId}] Failed to flush motion segments after ${maxRetries + 1} attempts, giving up`);
      state.saveRetryCount = 0;
      state.motionSegments = [];
    }
  }
}

async function flushMotionSegments(
  streamStates: Record<string, StreamMotionState>,
  dynamicStreams: Record<string, StreamManager>,
  streamId: string
): Promise<void> {
  const state = streamStates[streamId];
  const stream = dynamicStreams[streamId];

  if (state.motionSegments.length === 0) return;

  state.flushingSegments = [...new Set(state.motionSegments)];
  state.motionSegments = [];
  const existingSegmentsPromises = state.flushingSegments.map(async segmentPath => {
    return { segmentPath, exists: await fs.promises.access(segmentPath).then(() => true).catch(() => false) };
  });
  const existingSegments = (await Promise.all(existingSegmentsPromises)).filter(seg => seg.exists);

  if (existingSegments.length === 0) {
    logMotion(`[${streamId}] No existing segments to flush`);
    return;
  }

  // Determine flush number
  const flushFiles = await fs.promises.readdir(stream.config.flushDir)
    .then(files => files.filter(f => f.startsWith(state.recordingTitle + '_flush_')))
    .catch(() => []);
  const flushNumber = flushFiles.length + 1;

  const listFile = path.join(stream.config.flushDir, `concat_list_flush_${flushNumber}.txt`);
  const flushOutFile = path.join(stream.config.flushDir, `${state.recordingTitle}_flush_${flushNumber}.ts`);

  await fs.promises.writeFile(listFile, existingSegments.map(seg => `file '${seg.segmentPath.replace(/\\/g, '/')}'`).join('\n'));

  const ffmpegConcatCmd = `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${flushOutFile}"`;

  logMotion(`[${streamId}] Flushing ${existingSegments.length} segments to ${path.basename(flushOutFile)}`);

  await new Promise<void>((resolve, reject) => {
    exec(ffmpegConcatCmd, async (err) => {
      await safeUnlinkWithRetry(listFile);
      if (err) {
        logMotion(`[${streamId}] FFmpeg flush failed: ${err}`, 'error');
        state.motionSegments = state.flushingSegments; // Restore segments on error
        state.flushingSegments = [];
        reject(err);
        return;
      }
      // Remove flushed segments except recent ones
      const promises = state.flushingSegments.map(segment => {
        state.flushedSegments.push(segment);
        if (!state.recentSegments.includes(segment)) {
          return safeUnlinkWithRetry(segment);
        }
      });
      await Promise.all(promises);
      state.flushingSegments = [];
      resolve();
    });
  });
}

// --- Modified saveMotionSegments ---
async function saveMotionSegments(
  streamStates: Record<string, StreamMotionState>,
  dynamicStreams: Record<string, StreamManager>,
  streamId: string
): Promise<void> {
  const state = streamStates[streamId];
  const stream = dynamicStreams[streamId];

  if (state.flushingSegments.length > 0) {
    setTimeout(() => saveMotionSegments(streamStates, dynamicStreams, streamId), 1000);
    return;
  }

  state.savingInProgress = true;

  // Gather flushed recordings
  let flushedFiles: string[] = [];
  try {
    flushedFiles = await fs.promises.readdir(stream.config.flushDir)
      .then(files => files.filter(f => f.endsWith('.ts')).map(f => path.join(stream.config.flushDir, f)));
  } catch { }

  // Gather unflushed segments
  const uniqueSegments = [...new Set(state.motionSegments)];
  const existingSegmentsPromises = uniqueSegments.map(async segmentPath => {
    return { segmentPath, exists: await fs.promises.access(segmentPath).then(() => true).catch(() => false) };
  });
  const existingSegments = (await Promise.all(existingSegmentsPromises)).filter(seg => seg.exists).map(seg => seg.segmentPath);

  // Build concat list: flushed files first, then remaining segments
  const concatList: string[] = [
    ...flushedFiles.map(f => `file '${f.replace(/\\/g, '/')}'`),
    ...existingSegments.map(seg => `file '${seg.replace(/\\/g, '/')}'`)
  ];

  if (concatList.length === 0) {
    logMotion(`[${streamId}] No segments or flushed files to save`);
    state.savingInProgress = false;
    state.motionSegments = [];
    state.flushedSegments = [];
    return;
  }

  const listFile = path.join(stream.config.hlsDir, 'concat_list.txt');
  await fs.promises.writeFile(listFile, concatList.join('\n'));

  const outFile = path.join(stream.config.recordDir, state.recordingTitle);
  const thumbFile = path.join(stream.config.thumbDir, path.basename(outFile).replace(/\.mp4$/, '.jpg'));
  const ffmpegConcatCmd = `ffmpeg -y -f concat -safe 0 -i "${listFile}" -c copy "${outFile}"`;

  logMotion(`[${streamId}] Saving ${concatList.length} items (${flushedFiles.length
    } flushed + ${existingSegments.length} segments) to ${path.basename(outFile)}`);

  const ffmpegProcess = exec(ffmpegConcatCmd, async (err) => {
    if (ffmpegProcess.killed) {
      logMotion(`[${streamId}] Save operation was canceled`);
      state.savingInProgress = false;
      state.currentSaveProcess = null;
      await safeUnlinkWithRetry(listFile);
      return;
    }

    if (err) {
      logMotion(`[${streamId}] FFmpeg concat failed: ${err}`);
      state.savingInProgress = false;
      state.currentSaveProcess = null;
      state.motionSegments = [];
      state.flushedSegments = [];
      await safeUnlinkWithRetry(listFile);
      return;
    }

    // Generate thumbnail
    let seek = 7;
    const thumbProcess = exec(`ffmpeg -y -i "${outFile}" -ss ${seek.toFixed(2)} -vframes 1 -update 1 "${thumbFile}"`, async () => {
      // Clean up segments and flushed files
      const promises = [
        state.flushedSegments.concat(existingSegments).map(segment => {
          if (!state.recentSegments.includes(segment)) {
            return safeUnlinkWithRetry(segment);
          }
        }),
        ...flushedFiles.map(f => safeUnlinkWithRetry(f)),
        safeUnlinkWithRetry(listFile)
      ];
      await Promise.all(promises);

      logMotion(`[${streamId}] Cleared flushDir and saved segments`);
      state.motionSegments = [];
      state.flushedSegments = [];
      state.savingInProgress = false;
      state.currentSaveProcess = null;

      // Save to DB as before...
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

        logMotion(`[${streamId}] Successfully saved ${filename} (${duration}s, ${concatList.length} items)`);
      } catch (e) {
        logMotion(`[${streamId}] Failed to upsert MotionRecording: ${e}`);
      }
    });

    state.currentSaveProcess = thumbProcess;
  });

  state.currentSaveProcess = ffmpegProcess;

  const saveTimeout = setTimeout(() => {
    if (state.currentSaveProcess && !state.currentSaveProcess.killed) {
      logMotion(`[${streamId}] Save operation timed out, killing process`);
      state.currentSaveProcess.kill('SIGTERM');
      state.motionSegments = [];
      state.savingInProgress = false;
      state.currentSaveProcess = null;
    }
  }, 60000);

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
