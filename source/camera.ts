import dotenv from 'dotenv';
import express from 'express';
import jwt from 'jsonwebtoken';
import cors from 'cors';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import open from 'open'
import { exec, execSync } from 'child_process';
import * as admin from 'firebase-admin';
import webpush from 'web-push';
import * as chokidar from 'chokidar';
import { PrismaClient } from './generated/prisma';
import { StreamManager } from './streamManager';
import { detectMotion, clearMotionHistory } from './motionDetector';
import { DeviceInfo, TrustedDevice, getDeviceDisplayName } from './types/deviceInfo';
import Greenlock from 'greenlock-express';
import config from '../config.json'

dotenv.config();
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(__dirname, '..', 'security-cam-credentials.json');

export const prisma = new PrismaClient();

// Motion logging setup
const apiStartTime = new Date().toISOString().replace(/[:.]/g, '-');
const motionLogPath = path.join(__dirname, '..', 'logs', `motion`);
const authLogPath = path.join(__dirname, '..', 'logs', `auth`);

// Ensure logs directory exists
const logsDir = path.dirname(motionLogPath);
if (!fs.existsSync(logsDir)) {
  fs.mkdirSync(logsDir, { recursive: true });
}

// Motion logging function
export async function logMotion(message: string, level: 'info' | 'error' | 'warn' = 'info') {
  const timestamp = new Date().toISOString();
  const logEntry = `${timestamp} [${level}] ${message}\n`;
  try {
    await fs.promises.appendFile(`${motionLogPath}-latest.log`, logEntry);
  } catch (error) {
    console.error('Failed to write to motion log:', error);
  }
  if (level === 'error') {
    console.error(logEntry);
  } else if (level === 'warn') {
    console.warn(logEntry);
  }
}

export async function logAuth(message: string, level: 'info' | 'error' | 'warn' = 'info') {
  const timestamp = new Date().toISOString();
  const logEntry = `${timestamp} [${level}] ${message}\n`;
  try {
    await fs.promises.appendFile(`${authLogPath}-latest.log`, logEntry);
  } catch (error) {
    console.error('Failed to write to auth log:', error);
  }

  if (level === 'error') {
    console.error(logEntry);
  } else if (level === 'warn') {
    console.warn(logEntry);
  }
}

const JWT_SECRET = process.env.JWT_SECRET || config.jwtSecret;

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

interface RequestWithUser extends express.Request {
  user?: { username: string };
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
        notifyMotion(streamId, {
          title: 'Stream Restart Cooldown',
          body: `Stream ${streamId} is in FFmpeg restart cooldown due to repeated failures.`,
          icon: 'push_icon',
          sound: 'default',
          channelId: 'security_event_channel'
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
    configDir: config.greenlockConfigDir || path.join(__dirname, '..', 'greenlock.d'),
    maintainerEmail: config.maintainerEmail,
    cluster: false
  }).serve(app);

  setInterval(syncDeletedRecordings, 1000 * 60 * 60); // Sync deleted recordings every hour

  if (process.env.NODE_ENV !== 'production') {
    // Use HTTP for development
    // Always use Greenlock for HTTPS, but also start HTTP server in development for convenience
    const port = process.env.PORT || 3000;
    require('http').createServer(app).listen(port, () => {
      console.log(`Development HTTP server running on http://localhost:${port}`);
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
    try { jwts = JSON.parse(user.jwts || '[]'); } catch { jwts = []; }
    const validJwts = jwts.filter(token => {
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        return decoded && decoded.exp && decoded.exp * 1000 > now;
      } catch { return false; }
    });
    if (validJwts.length !== jwts.length) changed = true;

    // --- Refresh Tokens ---
    let refreshTokens: string[] = [];
    try { refreshTokens = JSON.parse(user.refreshTokens || '[]'); } catch { refreshTokens = []; }
    const validRefreshTokens = refreshTokens.filter(token => {
      try {
        const decoded = jwt.verify(token, JWT_SECRET) as any;
        return decoded && decoded.exp && decoded.exp * 1000 > now;
      } catch { return false; }
    });
    if (validRefreshTokens.length !== refreshTokens.length) changed = true;

    // --- Trusted Devices ---
    let trustedDevices: TrustedDevice[] = [];
    try { trustedDevices = JSON.parse(user.trustedIps || '[]'); } catch { trustedDevices = []; }
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
  origin: (process.env.NODE_ENV === 'production' ? [] : ['http://localhost:3000']).concat([config.baseUrl]),
  credentials: true
}));

app.use(express.json());

// --- JWT Middleware ---
async function jwtAuth(req: RequestWithUser, res: express.Response, next: express.NextFunction) {
  const auth = req.headers.authorization;
  if (!auth || !auth.startsWith('Bearer ')) {
    res.status(401).json({ error: 'Authentication required.' });
    return;
  }
  try {
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as { username: string };
    req.user = payload;

    // --- Trusted IPs check removed ---

    next();
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' });
  }
}

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
    fs.createReadStream(segmentPath).pipe(res.type('video/MP2T'));
  } catch {
    res.type('text/html').status(404).send('Segment not found');
    return
  }
});

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
        await saveMotionSegmentsWithRetry(streamId);
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

// --- JWT Auth Protected API Endpoints ---

app.get(/^\/recordings(\/[^\/]+)(\/[^\/]+)?$/, (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'web', 'dist', 'index.html'));
});

// Update the login endpoint in camera.ts
app.post('/api/login', express.json(), async (req, res) => {
  const { username, password, deviceInfo }: { username: string, password: string, deviceInfo: DeviceInfo } = req.body;

  console.log(`[Login] User ${username} attempting log in from IP: ${req.ip}`);

  if (!username || !password || !deviceInfo) {
    res.status(400).json({ error: 'Missing required fields' });
    return;
  }

  // Sanitize deviceInfo fields to avoid prototype pollution and ensure only expected keys
  const safeDeviceInfo: DeviceInfo = {
    userAgent: typeof deviceInfo?.userAgent === 'string' ? deviceInfo.userAgent : (req.headers['user-agent'] || 'Unknown'),
    platform: typeof deviceInfo?.platform === 'string' ? deviceInfo.platform : 'Unknown',
    vendor: typeof deviceInfo?.vendor === 'string' ? deviceInfo.vendor : 'Unknown',
    language: typeof deviceInfo?.language === 'string' ? deviceInfo.language : 'Unknown',
    timezone: typeof deviceInfo?.timezone === 'string' ? deviceInfo.timezone : 'Unknown',
    screen: typeof deviceInfo?.screen === 'string' ? deviceInfo.screen : 'Unknown',
    clientId: typeof deviceInfo?.clientId === 'string' ? deviceInfo.clientId : 'Unknown',
  };

  if (config.users.some(user => user.username === username && user.password === password)) {
    const token = jwt.sign({ username }, JWT_SECRET, { expiresIn: '5m' });
    const refreshToken = jwt.sign(
      { username, type: 'refresh', exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 },
      JWT_SECRET
    );

    let user = await prisma.user.findUnique({ where: { username } });

    // Create user if not exists, or update tokens if exists
    if (!user) {
      const newDevice = {
        ip: req.ip,
        deviceInfo: safeDeviceInfo,
        firstSeen: new Date().toISOString(),
        lastSeen: new Date().toISOString(),
        loginCount: 1
      };

      user = await prisma.user.create({
        data: {
          username,
          jwts: JSON.stringify([token]),
          refreshTokens: JSON.stringify([refreshToken]),
          trustedIps: JSON.stringify([newDevice])
        }
      });
    } else {
      // Update existing user
      let trustedDevices: TrustedDevice[] = [];
      try {
        trustedDevices = JSON.parse(user.trustedIps || '[]');
      } catch {
        trustedDevices = [];
      }


      // Find existing device or create new one
      const ipIsTrusted = trustedDevices.some(device => device.ip === req.ip)
      const existingDeviceIndex = trustedDevices.findIndex(device => {
        // Primary match: same client ID
        if (device.deviceInfo.clientId && safeDeviceInfo.clientId) {
          return device.deviceInfo.clientId === safeDeviceInfo.clientId;
        }
        // Fallback match: same IP and userAgent (for migration)
        return ipIsTrusted ?
          device.ip === req.ip && device.deviceInfo.userAgent === safeDeviceInfo.userAgent :
          device.deviceInfo.userAgent === safeDeviceInfo.userAgent;
      });
      const now = new Date().toISOString();

      if (existingDeviceIndex >= 0) {
        // Existing device - update info
        const device = trustedDevices[existingDeviceIndex];
        device.lastSeen = now;
        device.loginCount++;

        // Update IP if it changed (network switching)
        if (device.ip !== (req.ip || 'Unknown')) {
          console.log(`[${user.username}] Device ${device.deviceInfo.clientId} switched IP: ${device.ip} -> ${req.ip}`);
          device.ip = req.ip || 'Unknown';
        }

        // Update device info if provided
        if (safeDeviceInfo) {
          device.deviceInfo = { ...device.deviceInfo, ...safeDeviceInfo };
        }
      } else {
        await notifyMotion('login', {
          title: 'New Device Detected',
          body: `A login from a new ${getDeviceDisplayName(safeDeviceInfo)} device was detected from IP: ${req.ip}`,
          icon: 'push_icon',
          sound: 'default',
          channelId: 'security_event_channel'
        }, user.username);
        trustedDevices.push({
          ip: req.ip || 'Unknown',
          deviceInfo: safeDeviceInfo,
          firstSeen: now,
          lastSeen: now,
          loginCount: 1
        });
      }

      await prisma.user.update({
        where: { username },
        data: {
          jwts: JSON.stringify(Array.from(new Set([...(JSON.parse(user.jwts)), token]))),
          refreshTokens: JSON.stringify(Array.from(new Set([...(JSON.parse(user.refreshTokens)), refreshToken]))),
          trustedIps: JSON.stringify(trustedDevices)
        }
      });
    }

    console.log(`[Login] User ${username} logged in successfully from IP: ${req.ip}`);
    await notifyMotion('login', {
      title: 'Login Detected',
      body: `New log in from IP: ${req.ip}`,
      icon: 'push_icon',
      sound: 'default',
      channelId: 'login_event_channel'
    }, username);

    res.json({ success: true, token, refreshToken });
  } else {
    res.status(401).json({ success: false, message: 'Invalid credentials' });
  }
});

// Update the refresh token endpoint
app.post('/api/refresh-token', async (req, res) => {
  const refreshToken = String(req.headers['refresh-token'] || '');
  const { deviceInfo }: { deviceInfo?: DeviceInfo } = req.body;

  if (!refreshToken || !deviceInfo) {
    console.error('No refresh token and/or device info provided');
    res.status(401).json({ error: 'No refresh token and/or device info provided' });
    return;
  }

  // Sanitize deviceInfo fields to avoid prototype pollution and ensure only expected keys
  const safeDeviceInfo: DeviceInfo = {
    userAgent: typeof deviceInfo?.userAgent === 'string' ? deviceInfo.userAgent : (req.headers['user-agent'] || 'Unknown'),
    platform: typeof deviceInfo?.platform === 'string' ? deviceInfo.platform : 'Unknown',
    vendor: typeof deviceInfo?.vendor === 'string' ? deviceInfo.vendor : 'Unknown',
    language: typeof deviceInfo?.language === 'string' ? deviceInfo.language : 'Unknown',
    timezone: typeof deviceInfo?.timezone === 'string' ? deviceInfo.timezone : 'Unknown',
    screen: typeof deviceInfo?.screen === 'string' ? deviceInfo.screen : 'Unknown',
    clientId: typeof deviceInfo?.clientId === 'string' ? deviceInfo.clientId : 'Unknown',
  };

  // Find the user whose refreshTokens array contains the given refreshToken
  const user = await prisma.user.findFirst({
    where: {
      refreshTokens: {
        contains: `"${refreshToken}"`
      }
    }
  });

  if (!user) {
    console.error('Refresh token not found for any user:', refreshToken);
    res.status(401).json({ error: 'Invalid refresh token' });
    return;
  }

  logAuth(`[Refresh Token] User ${user.username} refreshing token from IP: ${req.ip}`);

  let tokens: string[] = [];
  try {
    tokens = JSON.parse(user.refreshTokens || '[]');
  } catch (err) {
    logAuth(`Failed to parse refresh tokens for user: ${user.username}`, 'error');
    res.status(500).json({ error: 'Failed to parse refresh tokens' });
    return;
  }

  const newRefreshToken = (() => {
    try {
      const decoded = jwt.verify(refreshToken, JWT_SECRET) as { exp?: number };
      if (!decoded.exp || decoded.exp < Math.floor(Date.now() / 1000)) {
        logAuth(`Refresh token expired for user: ${user.username}`, 'error');
        res.status(401).json({ error: 'Refresh token expired' });
        return null;
      }

      const newRefreshToken = jwt.sign(
        { username: user.username, type: 'refresh', exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 },
        JWT_SECRET
      );
      tokens = tokens.filter((t: string) => t !== refreshToken);
      tokens.push(newRefreshToken);
      return newRefreshToken;
    } catch (err) {
      logAuth(`Failed to verify refresh token for user: ${user.username}`, 'error');
      res.status(401).json({ error: 'Invalid refresh token' });
      return null;
    }
  })();

  if (!newRefreshToken) {
    logAuth(`Failed to generate new refresh token for user: ${user.username}`, 'error');
    res.status(401).json({ error: 'Failed to generate new refresh token' });
    return;
  }

  // Update trusted devices
  let trustedDevices: TrustedDevice[] = [];
  try {
    trustedDevices = JSON.parse(user.trustedIps || '[]');
  } catch {
    trustedDevices = [];
  }

  const ipIsTrusted = trustedDevices.some(device => device.ip === req.ip)
  const existingDeviceIndex = trustedDevices.findIndex(device => {
    if (device.deviceInfo.clientId && safeDeviceInfo.clientId) {
      return device.deviceInfo.clientId === safeDeviceInfo.clientId;
    }
    return ipIsTrusted ?
      device.ip === req.ip && device.deviceInfo.userAgent === safeDeviceInfo.userAgent :
      device.deviceInfo.userAgent === safeDeviceInfo.userAgent;
  });
  const now = new Date().toISOString();

  if (existingDeviceIndex >= 0) {
    // Existing device - update info
    const device = trustedDevices[existingDeviceIndex];
    device.lastSeen = now;
    device.loginCount++;

    // Update IP if it changed (network switching)
    if (device.ip !== (req.ip || 'Unknown')) {
      logAuth(`[${user.username}] Device ${device.deviceInfo.clientId} switched IP: ${device.ip} -> ${req.ip}`, 'warn');
      device.ip = req.ip || 'Unknown';
    }

    // Update device info if provided
    if (safeDeviceInfo) {
      device.deviceInfo = { ...device.deviceInfo, ...safeDeviceInfo };
    }
  } else {
    await notifyMotion('login', {
      title: 'Suspicious Activity Detected',
      body: `Unauthorized activity detected from IP: ${req.ip}`,
      icon: 'push_icon',
      sound: 'default',
      channelId: 'security_event_channel'
    }, user.username);
    res.status(403).json({ error: 'Unauthorized activity detected' });
    logAuth(`[${user.username}] Unauthorized activity detected from IP: ${req.ip}`, 'warn');
    return;
  }

  await prisma.user.update({
    where: { username: user.username },
    data: {
      refreshTokens: JSON.stringify(tokens),
      trustedIps: JSON.stringify(trustedDevices)
    }
  });

  const token = jwt.sign({ username: user.username }, JWT_SECRET, { expiresIn: '5m' });
  res.json({ success: true, token, refreshToken: newRefreshToken });
});

// Update the sessions endpoint to return device info
app.get('/api/user/sessions', jwtAuth, async (req: RequestWithUser, res) => {
  const username = req.user!.username;
  const user = await prisma.user.findUnique({
    where: { username },
    select: { trustedIps: true }
  });

  if (!user) {
    res.json([]);
    return;
  }

  try {
    const trustedDevices: TrustedDevice[] = JSON.parse(user.trustedIps || '[]');
    res.json(trustedDevices);
  } catch {
    res.json([]);
  }
});

app.post('/api/logout', async (req, res) => {
  const refreshToken = req.headers['refresh-token'];
  const { clientId }: { clientId?: string } = req.body;

  if (refreshToken) {
    // Remove the refreshToken from the user's refreshTokens array
    const users = await prisma.user.findMany({ where: { refreshTokens: { contains: `"${refreshToken}"` } } });
    for (const user of users) {
      try {
        const tokens = JSON.parse(user.refreshTokens || '[]');
        if (Array.isArray(tokens) && tokens.includes(refreshToken)) {
          const newTokens = tokens.filter((t: string) => t !== refreshToken);
          await prisma.user.update({
            where: { username: user.username },
            data: {
              refreshTokens: JSON.stringify(newTokens),
              trustedIps: JSON.stringify(
                (JSON.parse(user.trustedIps || '[]') as TrustedDevice[])
                  .filter(device => device.deviceInfo.clientId ? device.deviceInfo.clientId !== clientId : true)
              )
            }
          });

          logAuth(`[Logout] User ${user.username} logged out from IP: ${req.ip}`);
          res.json({ success: true });
          return
        }
      } catch {
        logAuth(`Failed to parse refreshTokens for user ${user.username}, skipping logout.`, 'error');
        res.status(500).json({ error: 'Failed to logout' });
      }
    }
  }
});

app.get('/api/hls-token', jwtAuth, (req, res) => {
  // Optionally, issue a JWT for HLS here if you want to protect HLS streams
  res.json({ token: 'not-used' });
});

app.get('/api/vapid-public-key', (req, res) => {
  res.json({ publicKey: config.vapid.publicKey });
});

// --- Push Notification Endpoints ---

webpush.setVapidDetails(
  config.vapid.email,
  config.vapid.publicKey,
  config.vapid.privateKey
);

function getPushSubKey(req: express.Request) {
  // Use username from JWT as the subscription key
  return (req as any).user.username;
}

app.post('/api/subscribe', jwtAuth, express.json(), async (req, res) => {
  const sid = getPushSubKey(req);
  const { endpoint, expirationTime, keys, fcmToken } = req.body;

  if (fcmToken) {
    await prisma.pushSubscription.upsert({
      where: { sid },
      update: { fcmToken },
      create: { sid, fcmToken }
    });
    res.json({ success: true });
    return;
  }

  if (!endpoint || !keys || !keys.p256dh || !keys.auth) {
    res.status(400).json({ error: 'Invalid subscription' });
    return;
  }
  await prisma.pushSubscription.upsert({
    where: { sid },
    update: {
      endpoint,
      expirationTime: expirationTime ?? null,
      p256dh: keys.p256dh,
      auth: keys.auth,
    },
    create: {
      sid,
      endpoint,
      expirationTime: expirationTime ?? null,
      p256dh: keys.p256dh,
      auth: keys.auth,
    }
  });
  res.json({ success: true });
});

app.post('/api/unsubscribe', jwtAuth, express.json(), async (req, res) => {
  const sid = getPushSubKey(req);
  const sub = await prisma.pushSubscription.findUnique({ where: { sid } });

  if (!sub) {
    res.json({ success: true });
    return;
  }

  if (req.body && req.body.fcmToken) {
    // Unsubscribe from FCM only
    await prisma.pushSubscription.update({
      where: { sid },
      data: { fcmToken: null }
    }).catch(() => { });
  } else {
    // Unsubscribe from Web Push only
    await prisma.pushSubscription.update({
      where: { sid },
      data: {
        endpoint: null,
        expirationTime: null,
        p256dh: null,
        auth: null,
      }
    }).catch(() => { });
  }

  // After update, check if both FCM and Web Push are now null
  const updated = await prisma.pushSubscription.findUnique({ where: { sid } });
  if (
    (!updated?.fcmToken) &&
    (!updated?.endpoint && !updated?.p256dh && !updated?.auth)
  ) {
    await prisma.pushSubscription.delete({ where: { sid } }).catch(() => { });
  }

  res.json({ success: true });
});

async function notifyMotion(streamId: string, custom?: { title?: string; body?: string, icon?: string, sound?: string, channelId?: string, tag?: string }, username?: string) {
  let nickname;
  if (!custom?.body) ({ nickname } = await prisma.stream.findUnique({
    where: { id: streamId },
    select: { nickname: true }
  }) || { nickname: dynamicStreams[streamId]?.config.ffmpegInput });
  const title = custom?.title || 'Motion Detected!';
  const body = custom?.body || `Motion was detected by ${nickname}.`;
  const icon = custom?.icon || 'push_icon';
  const sound = custom?.sound || 'motion_alert';
  const channelId = custom?.channelId || 'motion_event_channel';
  const tag = custom?.tag || 'motion_event';

  const subs = await prisma.pushSubscription.findMany(username ? { where: { sid: username } } : undefined);
  for (const sub of subs) {
    // Web Push
    if (sub.endpoint && sub.p256dh && sub.auth) {
      try {
        await webpush.sendNotification(
          {
            endpoint: sub.endpoint,
            expirationTime: sub.expirationTime ? Number(sub.expirationTime) : undefined,
            keys: {
              p256dh: sub.p256dh,
              auth: sub.auth,
            }
          },
          JSON.stringify({
            title,
            body,
            data: {
              streamUrl: `${config.baseUrl}/stream/${streamId}`,
              cameraId: streamId,
              // ...other custom data
            }
          })
        );
      } catch (err) {
        console.error('Web Push notification error:', err);
        // Remove invalid web push subscription if 404
        if (
          typeof err === 'object' &&
          err !== null &&
          'statusCode' in err &&
          (err as any).statusCode === 404 &&
          sub.sid
        ) {
          await prisma.pushSubscription.update({ where: { sid: sub.sid }, data: { endpoint: null, p256dh: null, auth: null } }).catch(() => { });
        }
      }
    }
    // FCM Push
    if (sub.fcmToken) {
      try {
        await admin.messaging().send({
          android: {
            priority: 'high',
            notification: {
              title,
              body,
              icon,
              color: '#2196F3',
              sound,
              tag,
              channelId,
              visibility: 'public',
              sticky: false,
              localOnly: false,
              defaultLightSettings: true,
              eventTimestamp: new Date(),
              notificationCount: 1,
              vibrateTimingsMillis: [0, 500, 500, 500],
              // clickAction: 'OPEN_STREAM',
            }
          },
          token: sub.fcmToken,
          notification: {
            title,
            body
          },
          data: {
            streamUrl: `${config.baseUrl}/stream/${streamId}`,
            cameraId: streamId,
            // ...other custom data
          }
        });
      } catch (err: any) {
        if (!err) throw new Error('FCM notification error: No error object provided');

        if (err.code === 'messaging/server-unavailable') {
          console.warn('FCM server unavailable, retrying...');
          return setTimeout(() => {
            notifyMotion(streamId, custom);
          }, 5000); // Retry after 5 seconds
        } else if (err.code === 'messaging/registration-token-not-registered') {
          console.warn(`Invalid FCM token, removing from subscription for ${sub.sid}`)
          return prisma.pushSubscription.update({
            where: { sid: sub.sid },
            data: { fcmToken: null }
          }).catch(() => { });
        }

        console.error('FCM notification error:', err);
      }
    }
  }
}

// --- Helper to create a signed URL
function createSignedUrl(streamId: string, filename: string, type: 'video' | 'thumbnail', expiresInSeconds = 300) {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const secret = process.env.SIGNED_URL_SECRET || JWT_SECRET;
  const data = `${streamId}:${filename}:${type}:${expires}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('hex');
  return { url: `/signed/${type}/${streamId}/${encodeURIComponent(filename)}?expires=${expires}&sig=${sig}`, expiresAt: expires };
}

// Function to verify signed URL
function verifySignedUrl(streamId: string, filename: string, type: 'video' | 'thumbnail', expires: string, sig: string) {
  const secret = process.env.SIGNED_URL_SECRET || JWT_SECRET;
  const data = `${streamId}:${filename}:${type}:${expires}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('hex');
  if (sig !== expectedSig) return false;
  if (parseInt(expires) < Math.floor(Date.now() / 1000)) return false;
  return true;
}

// --- Helper to create a signed stream playlist URL for a specific stream ---
function createSignedStreamUrl(streamId: string, expiresInSeconds = 300) {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const secret = process.env.SIGNED_URL_SECRET || JWT_SECRET;
  const data = `stream:${streamId}:${expires}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('hex');
  return `/signed/stream/${streamId}/stream.m3u8?expires=${expires}&sig=${sig}`;
}

// --- Helper to verify a signed stream playlist/segment URL ---
function verifySignedStreamUrl(streamId: string, expires: string, sig: string) {
  const secret = process.env.SIGNED_URL_SECRET || JWT_SECRET;
  const data = `stream:${streamId}:${expires}`;
  const expectedSig = crypto.createHmac('sha256', secret).update(data).digest('hex');
  if (sig !== expectedSig) return false;
  if (parseInt(expires) < Math.floor(Date.now() / 1000)) return false;
  return true;
}

// --- Start New Multiple Stream Code ---










// --- Per-stream motion state ---
interface StreamMotionState {
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
}

const streamStates: Record<string, StreamMotionState> = {};

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
      startedRecordingAt: 0 // Initialize to 0
    };

    logMotion(`[${streamId}] Monitoring started at ${new Date().toLocaleString()}`);

    // --- Motion Detection Watcher ---
    chokidar.watch(dynamicStreams[streamId].config.hlsDir, { ignoreInitial: true }).on('add', segmentPath => {
      if (!/segment_\d+\.ts$/.test(path.basename(segmentPath))) return;
      const state = streamStates[streamId];
      state.recentSegments.push(segmentPath);
      if (state.recentSegments.length > RECENT_SEGMENT_BUFFER) {
        const expiredSegment = state.recentSegments.shift();
        if (!state.motionRecordingActive && !state.savingInProgress && expiredSegment) {
          safeUnlink(expiredSegment);
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
            notifyMotion(streamId);
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
            saveMotionSegmentsWithRetry(streamId).then(() => {
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
}

// --- Save motion segments per stream ---
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

// Enhanced save function with retry logic
async function saveMotionSegmentsWithRetry(streamId: string, retryAttempt: number = 0): Promise<void> {
  const state = streamStates[streamId];
  const maxRetries = 2;

  try {
    await saveMotionSegments(streamId);
    state.saveRetryCount = 0; // Reset retry count on success
  } catch (error) {
    logMotion(`[${streamId}] Motion save attempt ${retryAttempt + 1} failed: ${error}`);

    if (retryAttempt < maxRetries) {
      const delay = Math.min(1000 * Math.pow(2, retryAttempt), 5000); // Exponential backoff, max 5 seconds
      logMotion(`[${streamId}] Retrying save in ${delay}ms (attempt ${retryAttempt + 2}/${maxRetries + 1})`);

      setTimeout(() => {
        saveMotionSegmentsWithRetry(streamId, retryAttempt + 1);
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

// Update the saveMotionSegments function in camera.ts
async function saveMotionSegments(streamId: string): Promise<void> {
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
      await safeUnlink(listFile);
      // Don't clear motionSegments since we want to keep them for continued recording
      return; // Don't reject since cancellation is expected behavior
    }

    if (err) {
      logMotion(`[${streamId}] FFmpeg concat failed: ${err}`);
      state.savingInProgress = false;
      state.currentSaveProcess = null;
      state.motionSegments = []; // Clear segments on error
      await safeUnlink(listFile);
      throw err;
    }

    // Generate thumbnail
    let seek = 7; // Default seek time for thumbnail
    const thumbProcess = exec(`ffmpeg -y -i "${outFile}" -ss ${seek.toFixed(2)} -vframes 1 -update 1 "${thumbFile}"`, async (thumbErr) => {
      // Clean up segments that are no longer needed
      const promises = existingSegments.map(seg => {
        if (!state.recentSegments.includes(seg.segmentPath)) {
          return safeUnlink(seg.segmentPath);
        }
      });
      promises.push(safeUnlink(listFile))
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

// --- Persist stream state to database ---
async function persistStreamState(streamId: string) {
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

// --- Get all recordings for a stream ---
app.get('/api/recordings/:streamId', jwtAuth, async (req, res) => {
  const { streamId } = req.params;
  const username = (req as any).user.username;
  const { from, to } = req.query;

  // Query from MotionRecording table
  let where: any = { streamId };
  if (from || to) {
    where.filename = {};
    if (from) where.recordedAt.gte = from;
    if (to) where.recordedAt.lte = to;
  }
  const recordings = await prisma.motionRecording.findMany({
    where,
    orderBy: { filename: 'desc' }
  });

  // Only update lastSeen if the newest file is newer than the current lastSeen
  if (recordings.length > 0) {
    try {
      const current = await prisma.userLastSeenRecording.findUnique({
        where: { username_streamId: { username, streamId } }
      });
      const currentLastSeen = current?.lastSeen;
      if (!currentLastSeen || recordings[0].filename.localeCompare(currentLastSeen) < 0) {
        await prisma.userLastSeenRecording.upsert({
          where: { username_streamId: { username, streamId } },
          update: { lastSeen: recordings[0].filename },
          create: { username, streamId, lastSeen: recordings[0].filename }
        });
      }
    } catch (err) {
      console.error(`[${streamId}] [Recordings] Failed to update last seen recording for ${username}:`, err);
    }
  }

  res.json(recordings);
});

// --- Paginated recordings endpoint ---
app.get('/api/recordings/:streamId/:page', jwtAuth, async (req, res) => {
  const { streamId, page } = req.params;
  const username = (req as any).user.username;
  const pageNum = Math.max(1, parseInt(page, 10) || 1);
  const PAGE_SIZE = 50;

  const total = await prisma.motionRecording.count({ where: { streamId } });
  const recordings = await prisma.motionRecording.findMany({
    where: { streamId },
    orderBy: { filename: 'desc' },
    skip: (pageNum - 1) * PAGE_SIZE,
    take: PAGE_SIZE,
  });

  // Get current lastSeen to determine what deleted recordings to send
  const currentLastSeen = await prisma.userLastSeenRecording.findUnique({
    where: { username_streamId: { username, streamId } }
  });

  // Get deleted recordings that are newer than or equal to lastSeen
  let deletedRecordings: string[] = [];
  if (currentLastSeen?.lastSeen) {
    const deleted = await prisma.deletedRecording.findMany({
      where: {
        streamId,
        filename: { gte: currentLastSeen.lastSeen } // Include recordings from lastSeen onwards
      },
      select: { filename: true },
      orderBy: { filename: 'desc' }
    });
    deletedRecordings = deleted.map(d => d.filename);
  } else {
    // If no lastSeen, send all deleted recordings
    const deleted = await prisma.deletedRecording.findMany({
      where: { streamId },
      select: { filename: true },
      orderBy: { filename: 'desc' }
    });
    deletedRecordings = deleted.map(d => d.filename);
  }

  // Update lastSeen if we have recordings and they're newer
  if (recordings.length > 0) {
    try {
      if (!currentLastSeen?.lastSeen || recordings[0].filename.localeCompare(currentLastSeen.lastSeen) > 0) {
        await prisma.userLastSeenRecording.upsert({
          where: { username_streamId: { username, streamId } },
          update: { lastSeen: recordings[0].filename },
          create: { username, streamId, lastSeen: recordings[0].filename }
        });
      }
    } catch (err) {
      console.error(`[${streamId}] [Recordings] Failed to update last seen recording for ${username}:`, err);
    }
  }

  res.json({
    total,
    recordings,
    deletedRecordings // Include deleted recordings in response
  });
});

// Latest recordings endpoint
app.get('/api/latest-recordings/:streamId', jwtAuth, async (req, res) => {
  const { streamId } = req.params;
  const username = (req as any).user.username;
  const seen = await prisma.userLastSeenRecording.findUnique({
    where: { username_streamId: { username, streamId } }
  });
  const lastSeen = seen?.lastSeen;

  if (!lastSeen) {
    // If no lastSeen, throw an error
    res.status(400).json({ error: 'No last seen recording found' });
    return;
  }

  // Only fetch new recordings (filenames greater than lastSeen)
  const recordings = await prisma.motionRecording.findMany({
    where: {
      streamId,
      ...(lastSeen && { filename: { gt: lastSeen } }),
    },
    orderBy: { filename: 'desc' },
    select: { filename: true }
  });

  const newRecordings = recordings.map(r => r.filename);

  // Get deleted recordings since lastSeen
  let deletedRecordings: string[] = [];
  if (lastSeen) {
    const deleted = await prisma.deletedRecording.findMany({
      where: {
        streamId,
        filename: { gt: lastSeen } // Only new deletions since lastSeen
      },
      select: { filename: true },
      orderBy: { filename: 'desc' }
    });
    deletedRecordings = deleted.map(d => d.filename);
  }

  res.json({
    recordings: newRecordings,
    deletedRecordings // Include new deletions
  });

  // Update lastSeen to the newest file
  if (newRecordings.length > 0) {
    await prisma.userLastSeenRecording.upsert({
      where: { username_streamId: { username, streamId } },
      update: { lastSeen: newRecordings[0] },
      create: { username, streamId, lastSeen: newRecordings[0] }
    });
  }
});

// --- Serve a recording file for a stream ---
app.get('/recordings/:streamId/file/:filename', jwtAuth, (req, res) => {
  const { streamId, filename } = req.params;
  if (!/^[\w\-\.]+\.mp4$/.test(filename)) { res.status(400).json({ error: 'Invalid filename' }); return; }
  const stream = dynamicStreams[streamId];
  if (!stream) { res.status(404).json({ error: 'Stream not found' }); return; }
  const filePath = path.join(stream.config.recordDir, filename);
  res.sendFile(filePath, (err: any) => {
    if (res.headersSent) return;
    if (err && err.code !== 'ECONNABORTED') {
      res.status(404).json({ error: 'File not found' });
      console.error(`[${streamId}] Failed to serve recording file ${filename}:`, JSON.stringify(err, null, 2));
    }
  });
});



// --- Serve masks for a stream ---
app.get('/api/masks/:streamId', jwtAuth, async (req, res) => {
  const { streamId } = req.params;
  const masks = await prisma.streamMask.findMany({ where: { streamId } });
  res.json(masks)
});

// --- Create and delete masks for a stream ---
app.post('/api/masks/:streamId', jwtAuth, express.json(), async (req, res) => {
  const { streamId } = req.params;
  const { mask } = req.body;
  if (
    !mask ||
    (mask.type && mask.type !== 'fixed' && mask.type !== 'relative') ||
    !['x', 'y', 'w', 'h'].every(k => Number.isInteger(mask[k]))
  ) {
    res.status(400).json({ success: false, error: 'Invalid mask data' });
    return;
  }
  const orderedMask = {
    x: mask.x,
    y: mask.y,
    w: mask.w,
    h: mask.h
  }
  await prisma.streamMask.create({
    data: {
      streamId,
      mask: JSON.stringify(orderedMask),
      ...(typeof mask.type !== 'undefined' ? { type: mask.type } : {})
    }
  })
    .then(newMask => res.json({ success: true, mask: newMask }))
    .catch(() => res.status(500).json({ success: false, error: 'Failed to save mask' }));
});

app.patch('/api/masks/:streamId/:maskId', jwtAuth, express.json(), async (req, res) => {
  const { streamId, maskId } = req.params;
  const { mask } = req.body;
  if (
    !mask ||
    (mask.type && mask.type !== 'fixed' && mask.type !== 'conditional') ||
    !['x', 'y', 'w', 'h'].every(k => Number.isInteger(mask[k]))
  ) {
    console.log(`[PATCH] Invalid mask data for stream ${streamId}, maskId ${maskId}:`, mask);
    res.status(400).json({ success: false, error: 'Invalid mask data' });
    return;
  }
  const orderedMask = {
    x: mask.x,
    y: mask.y,
    w: mask.w,
    h: mask.h
  };
  try {
    const updated = await prisma.streamMask.update({
      where: { id_streamId: { streamId, id: maskId } },
      data: {
        mask: JSON.stringify(orderedMask),
        updatedAt: new Date(),
        ...(typeof mask.type !== 'undefined' ? { type: mask.type } : {})
      }
    });
    res.json({ success: true, mask: updated });
  } catch (e) {
    res.status(500).json({ success: false, error: 'Failed to update mask' });
  }
});

app.delete('/api/masks/:streamId/:maskId', jwtAuth, express.json(), async (req, res) => {
  const { streamId, maskId } = req.params;
  await prisma.streamMask.delete({ where: { id_streamId: { streamId, id: maskId } } })
    .then(() => res.json({ success: true }))
    .catch(() => res.status(500).json({ success: false, error: 'Failed to delete mask' }));
});

// --- Helper to create a signed latest thumbnail URL for a stream ---
function createSignedLatestThumbUrl(streamId: string, expiresInSeconds = 300) {
  const expires = Math.floor(Date.now() / 1000) + expiresInSeconds;
  const secret = process.env.SIGNED_URL_SECRET || JWT_SECRET;
  const data = `latest-thumb:${streamId}:${expires}`;
  const sig = crypto.createHmac('sha256', secret).update(data).digest('hex');
  return `/signed/recordings/${streamId}/thumbnails/latest.jpg?expires=${expires}&sig=${sig}`;
}

// --- Helper to verify a signed latest thumbnail URL for a stream ---
function verifySignedLatestThumbUrl(streamId: string, expires: string, sig: string) {
  const secret = process.env.SIGNED_URL_SECRET || JWT_SECRET;
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

    const latestTs = tsFiles[0];
    const thumbName = 'latest.jpg';
    const thumbPath = path.join(stream.config.thumbDir, thumbName);
    const tsPath = path.join(stream.config.hlsDir, latestTs);

    // --- Lock logic start ---
    // Only regenerate if thumbnail doesn't exist or is older than the segment
    let regenerate = !streamThumbnailPromises[streamId];

    if (regenerate) {
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
        const ffmpegCmd = `ffmpeg -y -i "${tsPath}" -vf "select=eq(n\\,0),scale=320:180" -vframes 1 -update 1 "${thumbPath}"`;
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

    const latestTs = tsFiles[0];
    const thumbName = 'latest.jpg';
    const thumbPath = path.join(stream.config.thumbDir, thumbName);
    const tsPath = path.join(stream.config.hlsDir, latestTs);

    // --- Lock logic start ---
    // Only regenerate if thumbnail doesn't exist or is older than the segment
    let regenerate = !streamThumbnailPromises[streamId];

    if (regenerate) {
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

// --- Nickname endpoints ---
app.get('/api/recordings/:streamId/:filename/nickname', jwtAuth, async (req, res) => {
  const { streamId, filename } = req.params;
  const record = await prisma.motionRecording.findUnique({ where: { streamId_filename: { filename, streamId } } });
  res.json({ nickname: record?.nickname || '' });
});

app.post('/api/recordings/:streamId/:filename/nickname', jwtAuth, express.json(), async (req, res) => {
  const { streamId, filename } = req.params;
  const { nickname } = req.body;
  await prisma.motionRecording
    .update({
      where: { streamId_filename: { filename, streamId } },
      data: { nickname }
    })
    .then(() => res.json({ success: true }))
    .catch(() => res.status(500).json({ success: false, error: 'Failed to save nickname' }));
});

app.get('/api/recordings-nicknames/:streamId', jwtAuth, async (req, res) => {
  const { streamId } = req.params;
  const all = await prisma.motionRecording.findMany({ where: { streamId, nickname: { not: null } }, select: { filename: true, nickname: true } });
  res.json(all);
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
    fs.createReadStream(segmentPath).pipe(res.type('video/MP2T'));
  } catch (err) {
    if (res.headersSent) return;
    res.type('application/json').status(404).json({ error: 'File not found' });
    console.error(`[${streamId}] Failed to serve segment file ${segment}:`, JSON.stringify(err, null, 2));
  }
});

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
        saveMotionSegmentsWithRetry(streamId).then(() => {
          state.notificationSent = false;
          state.motionRecordingActive = false;
          state.motionRecordingTimeoutAt = 0;
        });
      }
    }

    await notifyMotion(streamId, {
      title: 'Motion Recording Paused',
      body: `Motion recording has been paused for ${nickname}.`,
      icon: 'push_icon',
      sound: 'default',
      channelId: 'motion_event_low_channel',
      tag: 'motion_pause'
    });
  } else {
    await notifyMotion(streamId, {
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

// --- Delete a recording file for a stream ---
app.delete('/api/recordings/:streamId/:filename', jwtAuth, async (req, res) => {
  const { streamId, filename } = req.params;
  if (!/^[\w\-\.]+\.mp4$/.test(filename)) { res.status(400).json({ error: 'Invalid filename' }); return; }
  const stream = dynamicStreams[streamId];
  if (!stream) { res.status(404).json({ error: 'Stream not found' }); return; }
  const filePath = path.join(stream.config.recordDir, filename);
  const thumbPath = path.join(stream.config.thumbDir, filename.replace(/\.mp4$/, '.jpg'));
  try {
    await Promise.all([
      fs.promises.rm(filePath, { force: true, recursive: true }),
      fs.promises.rm(thumbPath, { force: true, recursive: true })
    ]);
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete file' });
  }

  try {
    await Promise.all([
      prisma.motionRecording.delete({
        where: { streamId_filename: { streamId, filename } }
      }),
      prisma.deletedRecording.create({
        data: { streamId, filename }
      })]);
  } catch {
    res.status(500).json({ error: 'Deleted file, but failed to delete recording from database' });
    return;
  }

  res.json({ success: true });
});

// --- Bulk delete for a stream ---
app.post('/api/recordings/:streamId/bulk-delete', jwtAuth, express.json(), async (req, res) => {
  const { streamId } = req.params;
  const { filenames } = req.body;
  if (!Array.isArray(filenames) || filenames.some(f => !/^[\w\-\.]+\.mp4$/.test(f))) { res.status(400).json({ error: 'Invalid filenames' }); return; }
  const stream = dynamicStreams[streamId];
  if (!stream) { res.status(404).json({ error: 'Stream not found' }); return; }
  const results: { [filename: string]: boolean } = {};
  for (const filename of filenames) {
    const filePath = path.join(stream.config.recordDir, filename);
    const thumbPath = path.join(stream.config.thumbDir, filename.replace(/\.mp4$/, '.jpg'));
    try {
      await Promise.all([
        fs.promises.rm(filePath, { force: true, recursive: true }),
        fs.promises.rm(thumbPath, { force: true, recursive: true })
      ]);
    } catch (e) {
      results[filename] = false;
    }

    try {
      await Promise.all([
        prisma.motionRecording.delete({
          where: { streamId_filename: { streamId, filename } }
        }),
        prisma.deletedRecording.create({
          data: { streamId, filename }
        })]);
      results[filename] = true;
    } catch {
      results[filename] = false;
    }
  }

  res.json({ success: true, results });
});

// --- Safe unlink function ---
async function safeUnlink(filePath: string, retries = 3) {
  return fs.promises.rm(filePath, { force: true, recursive: true }).catch((error) => {
    if (error) {
      if (error.code === 'ENOENT' || error.code === 'EPERM') {
        // File was already deleted by another process, which is fine
        return;
      }

      if (error.code === 'EBUSY' && retries > 0) {
        // File is busy, retry after delay
        setTimeout(() => safeUnlink(filePath, retries - 1), 1000);
        console.warn(`Failed to delete file ${filePath} after ${3 - retries + 1} attempts:`, error);
        return;
      }
    }
  });
}

// --- Deleted recordings endpoint ---
app.get('/api/deleted-recordings/:streamId', jwtAuth, async (req, res) => {
  const { streamId } = req.params;

  // Return all deleted recordings after sync
  const deleted = await prisma.deletedRecording.findMany({
    where: { streamId },
    orderBy: { deletedAt: 'desc' }
  });

  res.json(deleted.map(d => d.filename));
});

// --- Stream Tiles API ---

// Helper: Validate ffmpegInput and credentials
function validateStreamInput({ ffmpegInput, rtspUser, rtspPass }: { ffmpegInput: string, rtspUser?: string, rtspPass?: string }) {
  // Only allow RTSP URLs or DirectShow device strings
  const isRtsp = /^rtsp:\/\//i.test(ffmpegInput);
  const isDirectShow = /^video=.+:audio=.+/i.test(ffmpegInput);
  if (!isRtsp && !isDirectShow) {
    return { valid: false, error: 'ffmpegInput must be an RTSP URL or DirectShow device string (video=...:audio=...)' };
  }
  if (isRtsp && ((rtspUser && !rtspPass) || (!rtspUser && rtspPass))) {
    return { valid: false, error: 'Both rtspUser and rtspPass must be provided for RTSP streams.' };
  }
  return { valid: true };
}

// Helper: Create StreamManager instance for a stream
function createStreamManager(stream: any) {
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
    rtspUser: stream.rtspUser || undefined,
    rtspPass: stream.rtspPass || undefined
  });
}

// List all streams
app.get('/api/streams', jwtAuth, async (req, res) => {
  const streams = await prisma.stream.findMany();
  res.json(streams);
});

// Create a new stream
app.post('/api/streams', jwtAuth, express.json(), async (req, res) => {
  const { nickname, ffmpegInput, rtspUser, rtspPass } = req.body;
  const count = await prisma.stream.count();
  if (count >= 4) {
    res.status(400).json({ error: 'Maximum of 4 streams allowed.' });
    return;
  }
  if (!nickname || !ffmpegInput) {
    res.status(400).json({ error: 'Nickname and ffmpegInput are required.' });
    return;
  }
  const validation = validateStreamInput({ ffmpegInput, rtspUser, rtspPass });
  if (!validation.valid) {
    res.status(400).json({ error: validation.error });
    return;
  }
  console.log(`[POST] Creating new stream with nickname: ${nickname}, ffmpegInput: ${ffmpegInput}, rtspUser: ${rtspUser}, rtspPass: ${rtspPass}`);
  try {
    const stream = await prisma.stream.create({ data: { nickname, ffmpegInput, rtspUser, rtspPass } });
    dynamicStreams[stream.id] = createStreamManager(stream);
    dynamicStreams[stream.id].startFFmpeg();
    res.status(201).json(stream);
  } catch (e) {
    res.status(500).json({ error: 'Failed to create stream.' });
  }
});

// Update a stream
app.patch('/api/streams/:id', jwtAuth, express.json(), async (req, res) => {
  const { id } = req.params;
  const { nickname, ffmpegInput, rtspUser, rtspPass } = req.body;
  const stream = await prisma.stream.findUnique({ where: { id } });
  if (!stream) {
    res.status(404).json({ error: 'Stream not found.' });
    return;
  }
  const validation = validateStreamInput({ ffmpegInput: ffmpegInput ?? stream.ffmpegInput, rtspUser: rtspUser ?? stream.rtspUser, rtspPass: rtspPass ?? stream.rtspPass });
  if (!validation.valid) {
    res.status(400).json({ error: validation.error });
    return;
  }
  console.log(`[PATCH] Updating stream ${id} with nickname: ${nickname}, ffmpegInput: ${ffmpegInput}, rtspUser: ${rtspUser}, rtspPass: ${rtspPass}`);
  try {
    const updated = await prisma.stream.update({
      where: { id },
      data: Object.fromEntries(
        Object.entries({ nickname, ffmpegInput, rtspUser, rtspPass }).filter(([_, v]) => v !== undefined)
      )
    });

    // Only restart ffmpeg if ffmpegInput, rtspUser, or rtspPass changed
    const shouldRestart =
      (ffmpegInput !== undefined && ffmpegInput !== stream.ffmpegInput) ||
      (rtspUser !== undefined && rtspUser !== stream.rtspUser) ||
      (rtspPass !== undefined && rtspPass !== stream.rtspPass);

    if (dynamicStreams[id] && shouldRestart) {
      dynamicStreams[id].ffmpeg?.kill('SIGINT');
      dynamicStreams[id] = createStreamManager(updated);
      dynamicStreams[id].startFFmpeg();
    }
    res.json(updated);
  } catch (e) {
    res.status(500).json({ error: 'Failed to update stream.' });
  }
});

// Delete a stream
app.delete('/api/streams/:id', jwtAuth, async (req, res) => {
  const { id } = req.params;
  const stream = await prisma.stream.findUnique({ where: { id } });
  if (!stream) {
    res.status(404).json({ error: 'Stream not found.' });
    return;
  }
  try {
    await prisma.stream.delete({ where: { id } });
    if (dynamicStreams[id]) {
      dynamicStreams[id].ffmpeg?.kill('SIGINT');
      delete dynamicStreams[id];
    }
    res.json({ success: true });
  } catch (e) {
    res.status(500).json({ error: 'Failed to delete stream.' });
  }
});

app.get('/api/user/sessions', jwtAuth, async (req: RequestWithUser, res) => {
  const username = req.user!.username;
  const user = await prisma.user.findUnique({
    where: { username },
    select: { trustedIps: true }
  });
  res.json(user ? JSON.parse(user.trustedIps) : []);
})

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
