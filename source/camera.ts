import '@dotenvx/dotenvx/config'
import express from 'express';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import open from 'open'
import * as admin from 'firebase-admin';
import webpush from 'web-push';
import * as chokidar from 'chokidar';
import { PrismaClient } from './generated/prisma';
import { StreamManager } from './streamManager';
import { detectMotion, cleanFrameCache, debugLog } from './motionDetector';
import { TrustedDevice } from './types/deviceInfo';
import Greenlock from 'greenlock-express';
import config from '../config.json'
import { jwtAuth } from './middleware/jwtAuth';
import initializeMotionRoutes, { saveMotionSegmentsWithRetry } from './routes/motion';
import initializeAuthRoutes from './routes/auth';
import initializeNotificationRoutes, { notify } from './routes/notifications';
import initializeRecordingRoutes from './routes/recordings';
import initializeMaskRoutes from './routes/masks';
import initializeStreamRoutes from './routes/streams';
import { logMotion } from './logMotion';
import consoleStamp from 'console-stamp';
import chalk from 'chalk';

consoleStamp(console, {
  format: ':date(yyyy-mm-dd HH:MM:ss.l).yellow.bgBlue :level() :msg',
  include: ['log', 'info', 'warn', 'error', 'debug'],
  level: 'debug',
  tokens: {
    level: (opts) => {
      // opts.method is the log level (e.g., 'info', 'warn', etc.)
      const level = opts.method;
      let colorFn = (s: string) => s; // default: no color
      switch (level) {
        case 'info':
          colorFn = chalk.cyan;
          break;
        case 'debug':
          colorFn = chalk.gray;
          break;
        case 'warn':
          colorFn = chalk.yellow;
          break;
        case 'error':
          colorFn = chalk.red;
          break;
        default:
          colorFn = chalk.white;
      }
      // Default label format: [LEVEL]
      const label = `[${level.toUpperCase()}]`.padEnd(7, ' ');
      return colorFn(label);
    }
  }
});

process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(__dirname, '..', 'security-cam-credentials.json');

export const prisma = new PrismaClient();

// Motion logging setup
const apiStartTime = new Date().toISOString().replace(/[:.]/g, '-');
export const motionLogPath = path.join(__dirname, '..', 'logs', `motion`);
export const authLogPath = path.join(__dirname, '..', 'logs', `auth`);

// Ensure logs directory exists
const logsDir = path.dirname(motionLogPath);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

export const JWT_SECRET = process.env.JWT_SECRET as string;

if (!JWT_SECRET) {
  console.error('JWT_SECRET environment variable is not set!');
  process.exit(1);
}

if (!admin.apps.length) {
  admin.initializeApp({
    credential: admin.credential.applicationDefault(),
  });
}

// --- Configuration ---
const app = express();

// --- Constants ---
const MOTION_RECORDING_TIMEOUT_SECONDS = {
  normal: 45,
  cameraMovement: 30 // shorter timeout for camera movement to avoid long recordings
};

/**
 * Number of recent video segments to buffer.
 * 
 * This constant determines how many of the most recent video segments
 * should be kept in memory or storage for quick access or processing.
 * Adjust this value based on memory constraints and application requirements.
 */
const RECENT_SEGMENT_BUFFER = 6;
const STARTUP_GRACE_PERIOD = 10; // seconds

const streamThumbnailPromises: Record<string, Promise<{ success: boolean }> | null> = {};

// In-memory map of StreamManagers
const dynamicStreams: Record<string, StreamManager> = {};

export interface RequestWithUser extends express.Request {
  user?: { username: string };
}

// --- Per-stream motion state ---
export interface StreamMotionState {
  notificationSent: boolean;
  motionRecordingActive: boolean;
  motionTimeout: NodeJS.Timeout | null;
  motionRecordingTimeoutAt: number;
  motionSegments: string[];
  recentSegments: string[];
  motionPaused: boolean;
  startupTime: number;
  savingInProgress: boolean;
  currentSaveProcess: any | null;
  saveRetryCount: number;
  startedRecordingAt: number; // New field - timestamp when recording started
  lastSegmentProcessAt?: number; // Add for throttling segment processing
}

const streamStates: Record<string, StreamMotionState> = {};

async function setupStreamMotionMonitoring() {
  const persistedStates = await loadPersistedStreamStates();
  for (const streamId in dynamicStreams) {
    streamStates[streamId] = {
      notificationSent: false,
      motionRecordingActive: false,
      motionTimeout: null,
      motionRecordingTimeoutAt: 0,
      motionSegments: [],
      recentSegments: [],
      motionPaused: persistedStates[streamId]?.motionPaused ?? false,
      startupTime: Date.now(),
      savingInProgress: false,
      currentSaveProcess: null,
      saveRetryCount: 0,
      startedRecordingAt: 0,
      lastSegmentProcessAt: 0 // Initialize
    };

    logMotion(`[${streamId}] Monitoring started at ${new Date().toLocaleString()}`);

    // --- Motion Detection Watcher ---
    chokidar.watch(dynamicStreams[streamId].config.hlsDir, { ignoreInitial: true }).on('add', segmentPath => {
      if (!/segment_\d+\.ts$/.test(path.basename(segmentPath))) return;
      const state = streamStates[streamId];

      // --- Throttle segment processing to avoid busy loop ---
      const now = Date.now();
      const MIN_SEGMENT_PROCESS_INTERVAL = 300; // ms
      if (state.lastSegmentProcessAt && now - state.lastSegmentProcessAt < MIN_SEGMENT_PROCESS_INTERVAL) {
        if ((now - state.lastSegmentProcessAt) > 0) {
          debugLog(`[${streamId}] Throttling segment processing: last at ${now - state.lastSegmentProcessAt}ms ago`);
        }
        return;
      }
      state.lastSegmentProcessAt = now;

      state.recentSegments.push(segmentPath);
      if (state.recentSegments.length > RECENT_SEGMENT_BUFFER) {
        const expiredSegment = state.recentSegments.shift();
        if (!state.motionRecordingActive && !state.savingInProgress && expiredSegment) {
          safeUnlinkWithRetry(expiredSegment);
        }
      }
      setTimeout(async () => {
        if (state.motionPaused) return;
        if ((Date.now() - state.startupTime) / 1000 < STARTUP_GRACE_PERIOD) return;
        const motionStatus = await detectMotion(streamId, segmentPath);
        if (motionStatus.motion) {
          // If we're currently saving and detect new motion, cancel the save and continue recording
          if (state.savingInProgress && state.currentSaveProcess) {
            logMotion(`[${streamId}] New motion detected while saving, canceling save operation`);
            state.currentSaveProcess.kill('SIGTERM');
            state.savingInProgress = false;
            state.currentSaveProcess = null;
            state.saveRetryCount = 0;

            // Clear the motion timeout since we're continuing to record
            if (state.motionTimeout) {
              clearTimeout(state.motionTimeout);
              state.motionTimeout = null;
            }
          }

          if (!state.motionRecordingActive) {
            state.motionRecordingActive = true;
            state.startedRecordingAt = Date.now(); // Set when recording starts
            state.notificationSent = false;
            if (state.motionTimeout) clearTimeout(state.motionTimeout);
            state.recentSegments.forEach(recentPath => {
              if (!state.motionSegments.includes(recentPath)) state.motionSegments.push(recentPath);
            });
          }
          if (!state.motionSegments.includes(segmentPath)) state.motionSegments.push(segmentPath);

          // Log motion event
          logMotion(`[${streamId}] Detected at ${new Date().toLocaleString()} in segment: ${path.basename(segmentPath)}`);

          // --- Notify only once per motion event ---
          if (!state.notificationSent) {
            notify(dynamicStreams, streamId,
              { channelId: 'motion_event_channel', sound: 'motion_alert' });
            state.notificationSent = true;
          }

          // --- Set motion recording timeout ---
          let motionRecordingTimeoutMs = MOTION_RECORDING_TIMEOUT_SECONDS[motionStatus.aboveCameraMovementThreshold ? 'cameraMovement' : 'normal'] * 1000;

          if (state.motionRecordingTimeoutAt > 0 && Date.now() + motionRecordingTimeoutMs < state.motionRecordingTimeoutAt) {
            // If the new timeout is shorter than the current one, keep the current timeout
            motionRecordingTimeoutMs = state.motionRecordingTimeoutAt - Date.now();
          }

          if (state.motionTimeout) clearTimeout(state.motionTimeout);
          state.motionTimeout = setTimeout(() => {
            saveMotionSegmentsWithRetry(streamStates, dynamicStreams, streamId).then(() => {
              state.notificationSent = false;
            });
            state.motionRecordingActive = false;
            state.startedRecordingAt = 0; // Reset when recording stops
            state.motionRecordingTimeoutAt = 0;
          }, motionRecordingTimeoutMs);
          state.motionRecordingTimeoutAt = Date.now() + motionRecordingTimeoutMs;
        } else if (state.motionRecordingActive) {
          if (!state.motionSegments.includes(segmentPath)) state.motionSegments.push(segmentPath);
        }
      }, 300);
    });
  }

  setInterval(() => cleanFrameCache(dynamicStreams, streamStates), 5000);
}

// Load streams from DB on startup
async function loadStreamsFromDb() {
  const dbStreams = await prisma.stream.findMany();
  for (const s of dbStreams) {
    if (!dynamicStreams[s.id]) {
      dynamicStreams[s.id] = createStreamManager(s);
      dynamicStreams[s.id].startFFmpeg();
    }
  }

  // --- Monitor for FFmpeg cooldowns and alert ---
  setInterval(() => {
    for (const streamId in dynamicStreams) {
      const stream = dynamicStreams[streamId];
      if (stream && (stream as any).ffmpegCooldownUntil && Date.now() < (stream as any).ffmpegCooldownUntil) {
        logMotion(`[${streamId}] FFmpeg restart cooldown active until ${new Date((stream as any).ffmpegCooldownUntil).toLocaleTimeString()}`, 'warn');
        notify(dynamicStreams, streamId, {
          title: 'Stream Restart Cooldown',
          body: `Stream ${streamId} is in FFmpeg restart cooldown due to repeated failures.`,
          tag: 'server_event'
        });
      }
    }
  }, 60000); // Check every minute
}

loadStreamsFromDb().then(cleanupExpiredTokensAndDevices).then(setupStreamMotionMonitoring).then(() => {
  // --- Start server ---
  // Use Greenlock for production
  Greenlock.init({
    packageRoot: path.join(__dirname, '..'),
    configDir: config.greenlockConfigDir ?? path.join(__dirname, '..', 'greenlock.d'),
    maintainerEmail: config.maintainerEmail,
    cluster: false
  }).serve(app);

  setInterval(syncDeletedRecordings, 1000 * 60 * 60); // Sync deleted recordings every hour

  if (process.env.API_ENV !== 'production') {
    // Use HTTP for development
    // Always use Greenlock for HTTPS, but also start HTTP server in development for convenience
    const port = process.env.PORT ?? 3000;
    require('http').createServer(app).listen(port, () => {
      console.debug(`Development HTTP server running on http://localhost:${port}`);
      setTimeout(() => {
        open(`http://localhost:${port}`);
      }, 1500);
    });
  }
});

/**
 * Periodically clean up expired JWTs, refresh tokens, and old trusted devices.
 * - Runs every hour.
 * - Removes expired JWTs and refresh tokens from users.
 * - Removes trusted devices not seen in 7+ days.
 * - Deletes users with no trusted devices left.
 */
async function cleanupExpiredTokensAndDevices() {
  const now = Date.now();
  const SEVEN_DAYS_MS = 7 * 24 * 60 * 60 * 1000;

  const users = await prisma.user.findMany();
  for (const user of users) {
    let changed = false;

    // --- JWTs ---
    let jwts: string[] = [];
    try { jwts = JSON.parse(user.jwts ?? '[]'); } catch { jwts = []; }
    const validJwts = jwts.filter(token => {
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        return decoded && decoded.exp && decoded.exp * 1000 > now;
      } catch { return false; }
    });
    if (validJwts.length !== jwts.length) changed = true;

    // --- Refresh Tokens ---
    let refreshTokens: string[] = [];
    try { refreshTokens = JSON.parse(user.refreshTokens ?? '[]'); } catch { refreshTokens = []; }
    const validRefreshTokens = refreshTokens.filter(token => {
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        return decoded && decoded.exp && decoded.exp * 1000 > now;
      } catch { return false; }
    });
    if (validRefreshTokens.length !== refreshTokens.length) changed = true;

    // --- Trusted Devices ---
    let trustedDevices: TrustedDevice[] = [];
    try { trustedDevices = JSON.parse(user.trustedIps ?? '[]'); } catch { trustedDevices = []; }
    const filteredDevices = trustedDevices.filter(device => {
      const lastSeen = new Date(device.lastSeen).getTime();
      return !isNaN(lastSeen) && now - lastSeen < SEVEN_DAYS_MS;
    });
    if (filteredDevices.length !== trustedDevices.length) changed = true;

    if (changed) {
      await prisma.user.update({
        where: { username: user.username },
        data: {
          jwts: JSON.stringify(validJwts),
          refreshTokens: JSON.stringify(validRefreshTokens),
          trustedIps: JSON.stringify(filteredDevices)
        }
      }).catch(() => { });

      console.log(`[Cleanup] Updated user ${user.username} - removed ${(jwts.length - validJwts.length) + (refreshTokens.length - validRefreshTokens.length)
        } expired tokens and ${(trustedDevices.length - filteredDevices.length)} old devices.`);
    }

    // Run every hour
    setTimeout(cleanupExpiredTokensAndDevices, 60 * 60 * 1000)
  }
};

// --- CORS ---
app.use(cors({
  origin: (process.env.API_ENV === 'production' ? [] : ['http://localhost:3000'])
    .concat(process.env.VITE_BASE_URL ? [process.env.VITE_BASE_URL] : []),
  credentials: true
}));

app.use(express.json());

app.get('/hls/:streamId/stream.m3u8', jwtAuth, (req, res) => {
  const { streamId } = req.params;
  const stream = dynamicStreams[streamId];
  if (!stream) {
    res.status(404).send('Stream not found');
    return
  } 4
  fs.readFile(stream.getPlaylistPath(), 'utf8', (err, data) => {
    if (err) {
      res.status(404).send('Not found');
      return
    }
    res.type('application/vnd.apple.mpegurl').send(data);
  });
});

app.get('/hls/:streamId/:segment', jwtAuth, async (req, res) => {
  const { streamId, segment } = req.params;
  const stream = dynamicStreams[streamId];
  if (!stream || !/^segment_\d+\.ts$/.test(segment)) {
    res.status(404).send('Not found');
    return
  }

  try {
    const segmentPath = stream.getSegmentPath(segment);
    fs.createReadStream(segmentPath).on('error', () => {
      res.type('text/html').status(404).send('Segment not found');
    }).pipe(res.type('video/MP2T'));
  } catch {
    res.type('text/html').status(404).send('Segment not found');
    return
  }
});

process.on('SIGINT', () => cleanExit());
process.on('SIGTERM', () => cleanExit());
process.on('uncaughtException', err => {
  console.error('Uncaught Exception:', err);
  process.exit(1);
});
process.on('unhandledRejection', err => {
  console.error('Unhandled Rejection:', err);
  process.exit(1);
});

// --- Static & API Routes ---
app.use(express.static(path.join(__dirname, '..', 'web', 'dist')));
app.use('/recordings/thumbnails', jwtAuth, express.static(path.join(config.recordingsDirectory, 'thumbnails')));
app.get(/^\/(?!hls|api|recordings|signed|sounds).*/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'web', 'dist', 'index.html'));
});

app.get(/^\/recordings(\/[^\/]+)(\/[^\/]+)?$/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'web', 'dist', 'index.html'));
});

app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: config.vapid.publicKey });
});

webpush.setVapidDetails(
  config.vapid.email,
  config.vapid.publicKey,
  config.vapid.privateKey
);

initializeMotionRoutes(app, streamStates, dynamicStreams);
initializeAuthRoutes(app, dynamicStreams);
initializeNotificationRoutes(app);
initializeRecordingRoutes(app, dynamicStreams);
initializeMaskRoutes(app);
initializeStreamRoutes(app, dynamicStreams);

// --- Helper to create a signed URL
function createSignedUrl(streamId: string, filename: string, type: 'video' | 'thumbnail', expiresInSeconds = 300) {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const secret = process.env.SIGNED_URL_SECRET ?? JWT_SECRET;
  const data = `${streamId}:${filename}:${type}:${expires}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('hex');
  return { url: `/signed/${type}/${streamId}/${encodeURIComponent(filename)}?expires=${expires}&sig=${sig}`, expiresAt: expires };
}

// Function to verify signed URL
function verifySignedUrl(streamId: string, filename: string, type: 'video' | 'thumbnail', expires: string, sig: string) {
  const secret = process.env.SIGNED_URL_SECRET ?? JWT_SECRET;
  const data = `${streamId}:${filename}:${type}:${expires}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('hex');
  if (sig !== expectedSig) return false;
  if (parseInt(expires) < Math.floor(Date.now() / 1000)) return false;
  return true;
}

// --- Helper to create a signed stream playlist URL for a specific stream ---
function createSignedStreamUrl(streamId: string, expiresInSeconds = 300) {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const secret = process.env.SIGNED_URL_SECRET ?? JWT_SECRET;
  const data = `stream:${streamId}:${expires}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('hex');
  return `/signed/stream/${streamId}/stream.m3u8?expires=${expires}&sig=${sig}`;
}

// --- Helper to verify a signed stream playlist/segment URL ---
function verifySignedStreamUrl(streamId: string, expires: string, sig: string) {
  const secret = process.env.SIGNED_URL_SECRET ?? JWT_SECRET;
  const data = `stream:${streamId}:${expires}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('hex');
  if (sig !== expectedSig) return false;
  if (parseInt(expires) < Math.floor(Date.now() / 1000)) return false;
  return true;
}

// --- Start New Multiple Stream Code ---



// --- Helper to create a signed latest thumbnail URL for a stream ---
function createSignedLatestThumbUrl(streamId: string, expiresInSeconds = 300) {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const secret = process.env.SIGNED_URL_SECRET ?? JWT_SECRET;
  const data = `latest-thumb:${streamId}:${expires}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('hex');
  return `/signed/recordings/${streamId}/thumbnails/latest.jpg?expires=${expires}&sig=${sig}`;
}

// --- Helper to verify a signed latest thumbnail URL for a stream ---
function verifySignedLatestThumbUrl(streamId: string, expires: string, sig: string) {
  const secret = process.env.SIGNED_URL_SECRET ?? JWT_SECRET;
  const data = `latest-thumb:${streamId}:${expires}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('hex');
  if (sig !== expectedSig) return false;
  if (parseInt(expires) < Math.floor(Date.now() / 1000)) return false;
  return true;
}

// --- Endpoint to get a signed latest thumbnail URL for a stream ---
app.get('/api/signed-latest-thumb-url/:streamId', jwtAuth, (req, res) => {
  const { streamId } = req.params;
  if (!dynamicStreams[streamId]) { res.status(404).json({ error: 'Stream not found' }); return; }
  const url = createSignedLatestThumbUrl(streamId);
  res.json({ url });
});

// --- Serve signed latest thumbnail for a stream, generating it from the latest HLS segment ---
app.get('/signed/recordings/:streamId/thumbnails/latest.jpg', async (req, res) => {
  const { streamId } = req.params;
  const { expires, sig } = req.query;
  if (
    typeof streamId !== 'string' ||
    typeof expires !== 'string' ||
    typeof sig !== 'string' ||
    !dynamicStreams[streamId] ||
    !verifySignedLatestThumbUrl(streamId, expires, sig)
  ) {
    res.status(403).send('Forbidden');
    return;
  }

  const stream = dynamicStreams[streamId];

  fs.readdir(stream.config.hlsDir, async (err, files) => {
    if (err) { res.status(404).send('No segments'); return; }
    const tsFiles = files
      .filter(f => /^segment_(\d+)\.ts$/.test(f))
      .sort((a, b) => {
        const aNum = parseInt(a.match(/^segment_(\d+)\.ts$/)![1], 10);
        const bNum = parseInt(b.match(/^segment_(\d+)\.ts$/)![1], 10);
        return bNum - aNum;
      });

    if (tsFiles.length === 0) {
      res.status(404).send('No segments');
      return;
    }

    const state = streamStates[streamId]

    // --- If motion detection is active, serve the latest segment_*_motion.jpg if it exists ---
    if (!state?.motionPaused) {
      // Find the latest segment_*_motion.jpg file
      const motionJpgs = files
        .filter(f => /^segment_(\d+)_motion\.jpg$/.test(f))
        .sort((a, b) => {
          const aNum = parseInt(a.match(/^segment_(\d+)_motion\.jpg$/)![1], 10);
          const bNum = parseInt(b.match(/^segment_(\d+)_motion\.jpg$/)![1], 10);
          return bNum - aNum;
        });
      if (motionJpgs.length > 0) {
        const latestMotionJpg = motionJpgs[0];
        const latestMotionJpgPath = path.join(stream.config.hlsDir, latestMotionJpg);
        // Serve the motion jpg directly
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.sendFile(latestMotionJpgPath, (err: any) => {
          if (res.headersSent) return;
          if (err && err.code !== 'ECONNABORTED') {
            res.status(404).json({ error: 'File not found' });
            console.error(`[${streamId}] Failed to serve motion thumbnail file ${latestMotionJpg}:`, JSON.stringify(err, null, 2));
          }
        });
        return;
      }
      // If no motion jpg exists, fall through to original logic
    }

    // --- Lock logic start ---
    // Only regenerate if thumbnail doesn't exist or is older than the segment
    let regenerate = !streamThumbnailPromises[streamId];
    const thumbName = 'latest.jpg';
    const thumbPath = path.join(stream.config.thumbDir, thumbName);

    if (regenerate) {
      const latestTs = tsFiles[0];
      const tsPath = path.join(stream.config.hlsDir, latestTs);
      try {
        const [thumbStat, tsStat] = await Promise.all([
          fs.promises.stat(thumbPath).catch(() => null),
          fs.promises.stat(tsPath)
        ]);
        if (thumbStat && thumbStat.mtime > tsStat.mtime) {
          regenerate = false;
        }
      } catch { /* ignore */ }

      if (regenerate) {
        const ffmpegCmd = `ffmpeg -y -i "${tsPath}" -vf "select=eq(n\\,0),scale=160:90" -vframes 1 -update 1 "${thumbPath}"`;
        streamThumbnailPromises[streamId] = new Promise<{ success: boolean }>((resolve) => {
          require('child_process').exec(ffmpegCmd, (err: any) => {
            if (err) {
              console.error(`[${streamId}] Failed to generate thumbnail from ${latestTs}:`, err);
              resolve({ success: false });
            }
            else resolve({ success: true });
          });
        })
      }
    }

    const awaited = await streamThumbnailPromises[streamId]

    if (regenerate && !awaited?.success) {
      res.status(500).send('Failed to generate thumbnail');
      return;
    }

    // Reset the promise so it can be regenerated next time
    streamThumbnailPromises[streamId] = null;
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(thumbPath, (err: any) => {
      if (res.headersSent) return;
      if (err && err.code !== 'ECONNABORTED') {
        res.status(404).json({ error: 'File not found' });
        console.error(`[${streamId}] Failed to serve thumbnail file ${thumbName}:`, JSON.stringify(err, null, 2));
      }
    });
    // --- Lock logic end ---
  });
});

// --- Serve latest thumbnail for a stream, generating it from the latest HLS segment ---
app.get('/recordings/:streamId/thumbnails/latest.jpg', jwtAuth, async (req, res) => {
  const { streamId } = req.params;
  const stream = dynamicStreams[streamId];

  fs.readdir(stream.config.hlsDir, async (err, files) => {
    if (err) { res.status(404).send('No segments'); return; }
    const tsFiles = files
      .filter(f => /^segment_(\d+)\.ts$/.test(f))
      .sort((a, b) => {
        const aNum = parseInt(a.match(/^segment_(\d+)\.ts$/)![1], 10);
        const bNum = parseInt(b.match(/^segment_(\d+)\.ts$/)![1], 10);
        return bNum - aNum;
      });

    if (tsFiles.length === 0) {
      res.status(404).send('No segments');
      return;
    }

    const state = streamStates[streamId];

    // --- If motion detection is active, serve the latest segment_*_motion.jpg if it exists ---
    if (!state?.motionPaused) {
      // Find the latest segment_*_motion.jpg file
      const motionJpgs = files
        .filter(f => /^segment_(\d+)_motion\.jpg$/.test(f))
        .sort((a, b) => {
          const aNum = parseInt(a.match(/^segment_(\d+)_motion\.jpg$/)![1], 10);
          const bNum = parseInt(b.match(/^segment_(\d+)_motion\.jpg$/)![1], 10);
          return bNum - aNum;
        });
      if (motionJpgs.length > 0) {
        const latestMotionJpg = motionJpgs[0];
        const latestMotionJpgPath = path.join(stream.config.hlsDir, latestMotionJpg);
        // Serve the motion jpg directly
        res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
        res.setHeader('Pragma', 'no-cache');
        res.setHeader('Expires', '0');
        res.sendFile(latestMotionJpgPath, (err: any) => {
          if (res.headersSent) return;
          if (err && err.code !== 'ECONNABORTED') {
            res.status(404).json({ error: 'File not found' });
            console.error(`[${streamId}] Failed to serve motion thumbnail file ${latestMotionJpg}:`, JSON.stringify(err, null, 2));
          }
        });
        return;
      }
      // If no motion jpg exists, fall through to original logic
    }

    // --- Lock logic start ---
    // Only regenerate if thumbnail doesn't exist or is older than the segment
    let regenerate = !streamThumbnailPromises[streamId];
    const thumbName = 'latest.jpg';
    const thumbPath = path.join(stream.config.thumbDir, thumbName);

    if (regenerate) {
      const latestTs = tsFiles[0];
      const tsPath = path.join(stream.config.hlsDir, latestTs);
      try {
        const [thumbStat, tsStat] = await Promise.all([
          fs.promises.stat(thumbPath).catch(() => null),
          fs.promises.stat(tsPath)
        ]);
        if (thumbStat && thumbStat.mtime > tsStat.mtime) {
          regenerate = false;
        }
      } catch { /* ignore */ }

      if (regenerate) {
        const ffmpegCmd = `ffmpeg -y -i "${tsPath}" -vf "select=eq(n\\,0),scale=320:180" -vframes 1 "${thumbPath}"`;
        streamThumbnailPromises[streamId] = new Promise<{ success: boolean }>((resolve) => {
          require('child_process').exec(ffmpegCmd, { windowsHide: true }, (err: any) => {
            if (err) {
              console.error(`[${streamId}] Failed to generate thumbnail from ${latestTs}:`, err);
              resolve({ success: false });
            }
            else resolve({ success: true });
          });
        })
      }
    }

    const awaited = await streamThumbnailPromises[streamId]

    if (regenerate && !awaited?.success) {
      res.status(500).send('Failed to generate thumbnail');
      return;
    }

    // Reset the promise so it can be regenerated next time
    streamThumbnailPromises[streamId] = null;
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.sendFile(thumbPath, (err: any) => {
      if (res.headersSent) return;
      if (err && err.code !== 'ECONNABORTED') {
        res.status(404).json({ error: 'File not found' });
        console.error(`[${streamId}] Failed to serve thumbnail file ${thumbName}:`, JSON.stringify(err, null, 2));
      }
    });
    // --- Lock logic end ---
  });
});

// --- Serve thumbnails for a stream ---
app.use('/recordings/:streamId/thumbnails', jwtAuth, (req, res, next) => {
  const { streamId } = req.params;
  const stream = dynamicStreams[streamId];
  if (!stream) { res.status(404).send('Stream not found'); return; }
  // Only set cache-control for non-latest.jpg
  if (!req.url.endsWith('latest.jpg')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }
  express.static(stream.config.thumbDir)(req, res, next);
});

// Endpoint to get a signed stream playlist URL for a specific stream
app.get('/api/signed-stream-url/:streamId', jwtAuth, (req, res) => {
  const { streamId } = req.params;
  if (!dynamicStreams[streamId]) { res.status(404).json({ error: 'Stream not found' }); return; }
  const url = createSignedStreamUrl(streamId);
  res.json({ url });
});

// Endpoint to get a signed URL for a video or thumbnail from a specific stream
app.get('/api/signed-url/:streamId', jwtAuth, (req, res) => {
  const { streamId } = req.params;
  const { filename, type } = req.query;
  if (
    typeof filename !== 'string' ||
    (type !== 'video' && type !== 'thumbnail')
  ) {
    res.status(400).json({ error: 'Invalid parameters' });
    return
  }
  const url = createSignedUrl(streamId, filename, type as 'video' | 'thumbnail');
  res.json(url);
});

// Serve video file via signed URL
app.get('/signed/video/:streamId/:filename', (req, res) => {
  const { streamId, filename } = req.params;
  const { expires, sig } = req.query;
  if (
    typeof expires !== 'string' ||
    typeof sig !== 'string' ||
    !verifySignedUrl(streamId, filename, 'video', expires, sig)
  ) {
    res.status(403).send('Forbidden');
    return
  }
  const filePath = path.join(dynamicStreams[streamId].config.recordDir, filename);
  res.sendFile(filePath, (err: any) => {
    if (res.headersSent) return;
    if (err && err.code !== 'ECONNABORTED') {
      res.status(404).json({ error: 'File not found' });
      console.error(`[${streamId}] Failed to serve recording file ${filename}:`, JSON.stringify(err, null, 2));
    }
  });
});

app.get('/signed/thumbnail/:streamId/:filename', (req, res) => {
  const { streamId, filename } = req.params;
  const { expires, sig } = req.query;
  if (
    typeof expires !== 'string' ||
    typeof sig !== 'string' ||
    !verifySignedUrl(streamId, filename, 'thumbnail', expires, sig)
  ) {
    res.status(403).send('Forbidden');
    return
  }
  const thumbPath = path.join(dynamicStreams[streamId].config.thumbDir, filename);

  if (!req.url.endsWith('latest.jpg')) {
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
  }

  res.sendFile(thumbPath, (err: any) => {
    if (res.headersSent) return;
    if (err && err.code !== 'ECONNABORTED') {
      res.status(404).json({ error: 'File not found' });
      console.error(`[${streamId}] Failed to serve thumbnail file ${filename}:`, JSON.stringify(err, null, 2));
    }
  });
});

// Serve signed stream playlist for a specific stream
app.get('/signed/stream/:streamId/stream.m3u8', (req, res) => {
  const { streamId } = req.params;
  const { expires, sig } = req.query;
  if (
    typeof streamId !== 'string' ||
    typeof expires !== 'string' ||
    typeof sig !== 'string' ||
    !dynamicStreams[streamId] ||
    !verifySignedStreamUrl(streamId, expires, sig)
  ) {
    res.status(403).send('Forbidden');
    return;
  }
  const playlistPath = dynamicStreams[streamId].getPlaylistPath();
  fs.readFile(playlistPath, 'utf8', (err, data) => {
    if (err) {
      res.status(404).send('Not found');
      return;
    }
    let lines = data.split('\n');
    if (!lines.some(line => line.startsWith('#EXT-X-PLAYLIST-TYPE')))
      lines.splice(lines.findIndex(line => line.startsWith('#EXTM3U')) + 1, 0, '#EXT-X-PLAYLIST-TYPE:LIVE');
    if (!lines.some(line => line.startsWith('#EXT-X-ALLOW-CACHE')))
      lines.splice(lines.findIndex(line => line.startsWith('#EXT-X-PLAYLIST-TYPE:LIVE')) + 1, 0, '#EXT-X-ALLOW-CACHE:NO');
    lines = lines.filter(line => !line.startsWith('#EXT-X-ENDLIST'));
    // Rewrite segment URLs to signed segment URLs for this stream
    const rewritten = lines.join('\n').replace(/(segment_\d+\.ts)/g, (segment) =>
      `/signed/stream/${streamId}/${segment}?expires=${expires}&sig=${sig}`
    );
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', '*');
    res.type('application/vnd.apple.mpegurl').send(rewritten);
  });
});

// Serve signed stream segment for a specific stream
app.get('/signed/stream/:streamId/:segment', (req, res) => {
  const { streamId, segment } = req.params;
  const { expires, sig } = req.query;
  if (
    typeof streamId !== 'string' ||
    typeof segment !== 'string' ||
    typeof expires !== 'string' ||
    typeof sig !== 'string' ||
    !/^segment_\d+\.ts$/.test(segment) ||
    !dynamicStreams[streamId] ||
    !verifySignedStreamUrl(streamId, expires, sig)
  ) {
    res.status(403).send('Forbidden');
    return;
  }
  const segmentPath = dynamicStreams[streamId].getSegmentPath(segment);
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Headers', '*');
  try {
    fs.createReadStream(segmentPath).on('error', () => {
      res.type('text/html').status(404).send('Segment not found');
    }).pipe(res.type('video/MP2T'));
  } catch (err) {
    if (res.headersSent) return;
    res.type('application/json').status(404).json({ error: 'File not found' });
    console.error(`[${streamId}] Failed to serve segment file ${segment}:`, JSON.stringify(err, null, 2));
  }
});

// --- Safe unlink function ---
export async function safeUnlinkWithRetry(filePath: string, retries = 3) {
  const RETRY_DELAY_MS = 1000;
  if (retries <= 0) {
    logMotion(`[safeUnlinkWithRetry] Giving up deleting ${filePath} after retries`, 'warn');
    return;
  }
  return fs.promises.rm(filePath, { force: true, recursive: true }).catch((error) => {
    if (error) {
      if (error.code === 'ENOENT' || error.code === 'EPERM') {
        // File was already deleted by another process, which is fine
        return;
      }

      if (error.code === 'EBUSY') {
        setTimeout(() => safeUnlinkWithRetry(filePath, retries - 1), RETRY_DELAY_MS);
        logMotion(`[safeUnlinkWithRetry] Failed to delete file ${filePath} (EBUSY), will retry (${retries - 1} left)`, 'warn');
        return;
      }
    }
  });
}

// Helper: Create StreamManager instance for a stream
export function createStreamManager(stream: any) {
  // Use unique folders for each stream
  const hlsDir = path.join(__dirname, '..', `hls_${stream.id}`);
  const recordDir = path.join(config.recordingsDirectory, stream.id);
  const thumbDir = path.join(recordDir, 'thumbnails');
  return new StreamManager({
    id: stream.id,
    hlsDir,
    recordDir,
    thumbDir,
    ffmpegInput: stream.ffmpegInput,
    rtspUser: stream.rtspUser ?? undefined,
    rtspPass: stream.rtspPass ?? undefined
  });
}

async function loadPersistedStreamStates() {
  const all = await prisma.streamState.findMany();
  const persisted: Record<string, any> = {};
  for (const row of all) {
    try {
      persisted[row.streamId] = JSON.parse(row.state);
    } catch { }
  }
  return persisted;
}

// --- Persist stream state to database ---
export async function persistStreamState(streamId: string) {
  const state = streamStates[streamId];
  if (!state) return;
  // Only persist what you need (here, just motionPaused, but you can add more)
  const toPersist = { motionPaused: state.motionPaused };
  await prisma.streamState.upsert({
    where: { streamId },
    update: { state: JSON.stringify(toPersist), updatedAt: new Date() },
    create: { streamId, state: JSON.stringify(toPersist) }
  });
}

async function syncDeletedRecordings() {
  for (const streamId in dynamicStreams) {
    if (!dynamicStreams[streamId]) continue; // Skip if stream is not active
    try {
      const stream = dynamicStreams[streamId];
      if (stream) {
        // Get all recordings from DB that aren't already marked as deleted
        const allDbRecordings = await prisma.motionRecording.findMany({
          where: { streamId },
          select: { filename: true }
        });

        const existingDeleted = await prisma.deletedRecording.findMany({
          where: { streamId },
          select: { filename: true }
        });

        const deletedSet = new Set(existingDeleted.map(d => d.filename));
        const missingRecordings: string[] = [];

        // Check which files are missing from the filesystem
        for (const recording of allDbRecordings) {
          if (!deletedSet.has(recording.filename)) {
            const filePath = path.join(stream.config.recordDir, recording.filename);
            try {
              await fs.promises.access(filePath);
            } catch {
              missingRecordings.push(recording.filename);
            }
          }
        }

        // Add missing recordings to deleted table
        if (missingRecordings.length > 0) {
          console.log(`[${streamId}] Syncing ${missingRecordings.length} deleted recordings to database`);

          await prisma.deletedRecording.createMany({
            data: missingRecordings.map(filename => ({ streamId, filename })),
          });

          // Also remove them from the motion recordings table
          await prisma.motionRecording.deleteMany({
            where: {
              streamId,
              filename: { in: missingRecordings }
            }
          });
        }
      }
    } catch (error) {
      console.error(`[${streamId}] Error syncing deleted recordings:`, error);
      // Continue with the request even if sync fails
    }
  }
}

// --- Clean Exit Handler ---
async function cleanExit() {
  console.log('\nExiting... Cleaning up.');

  // Rename log files
  console.log('Renaming log files...')
  try {
    fs.renameSync(`${motionLogPath}-latest.log`, `${motionLogPath}-${apiStartTime}.log`);
    fs.renameSync(`${authLogPath}-latest.log`, `${authLogPath}-${apiStartTime}.log`);
  } catch (error) { console.error('Failed to rename log files:', error) }

  // First, save any pending motion segments before cleaning up directories
  for (const streamId of Object.keys(dynamicStreams)) {
    const state = streamStates[streamId];
    if (state?.motionTimeout) clearTimeout(state.motionTimeout);

    // Cancel any ongoing save operations
    if (state?.savingInProgress && state.currentSaveProcess) {
      console.log(`[${streamId}] [cleanExit] Canceling ongoing save operation`);
      state.currentSaveProcess.kill('SIGTERM');
    }

    // Save any pending segments BEFORE stopping FFmpeg and cleaning directories
    if (state?.motionSegments.length > 0) {
      logMotion(`[${streamId}] [cleanExit] Saving ${state.motionSegments.length} pending segments`);
      try {
        await saveMotionSegmentsWithRetry(streamStates, dynamicStreams, streamId);
      } catch (error) {
        console.error(`[${streamId}] [cleanExit] Failed to save pending segments:`, error);
      }
    }
  }

  // Then stop FFmpeg processes and clean up directories
  for (const streamId of Object.keys(dynamicStreams)) {
    dynamicStreams[streamId].ffmpeg?.kill('SIGINT');
    await new Promise(res => setTimeout(res, 1000));

    try {
      if (fs.existsSync(dynamicStreams[streamId].config.hlsDir)) {
        fs.rmSync(dynamicStreams[streamId].config.hlsDir, { recursive: true, force: true });
        console.log(`[Cleanup] Deleted HLS directory:`, dynamicStreams[streamId].config.hlsDir);
      }
    } catch (e) {
      console.warn(`[Cleanup] Failed to delete HLS directory:`, e);
    }
  }

  process.exit(0);
}
