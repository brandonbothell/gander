import { prisma, RequestWithUser, JWT_SECRET } from "../camera";
import { logAuth } from '../logMotion';
import { jwtAuth } from "../middleware/jwtAuth";
import { StreamManager } from "../streamManager";
import { DeviceInfo, TrustedDevice, getDeviceDisplayName } from "../types/deviceInfo";
import config from '../../config.json';
import express from "express";
import jwt from 'jsonwebtoken';
import { notify } from "./notifications";

export default function initializeAuthRoutes(app: express.Express, dynamicStreams: Record<string, StreamManager>) {
  app.post('/api/login', express.json(), async (req, res) => {
    const { username, password, deviceInfo }: { username: string, password: string, deviceInfo: DeviceInfo } = req.body;

    console.log(`[Login] User ${username} attempting log in from IP: ${req.ip}`);

    if (!username || !password || !deviceInfo) {
      res.status(400).json({ error: 'Missing required fields' });
      return;
    }

    // Sanitize deviceInfo fields to avoid prototype pollution and ensure only expected keys
    const safeDeviceInfo: DeviceInfo = {
      userAgent: typeof deviceInfo?.userAgent === 'string' ? deviceInfo.userAgent : (req.headers['user-agent'] ?? 'Unknown'),
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
          trustedDevices = JSON.parse(user.trustedIps ?? '[]');
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
          if (device.ip !== (req.ip ?? 'Unknown')) {
            console.log(`[${user.username}] Device ${device.deviceInfo.clientId} switched IP: ${device.ip} -> ${req.ip}`);
            device.ip = req.ip ?? 'Unknown';
          }

          // Update device info if provided
          if (safeDeviceInfo) {
            device.deviceInfo = { ...device.deviceInfo, ...safeDeviceInfo };
          }
        } else {
          await notify(dynamicStreams, 'login', {
            title: 'New Device Detected',
            body: `A login from a new ${getDeviceDisplayName(safeDeviceInfo)} device was detected from IP: ${req.ip}`,
          }, user.username);
          trustedDevices.push({
            ip: req.ip ?? 'Unknown',
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
      await notify(dynamicStreams, 'login', {
        title: 'Login Detected',
        body: `New log in from IP: ${req.ip}`,
      }, username);

      res.json({ success: true, token, refreshToken });
    } else {
      res.status(401).json({ success: false, message: 'Invalid credentials' });
    }
  });

  // Update the refresh token endpoint
  app.post('/api/refresh-token', async (req, res) => {
    const refreshToken = String(req.headers['refresh-token'] ?? '');
    const { deviceInfo }: { deviceInfo?: DeviceInfo } = req.body;

    if (!refreshToken || !deviceInfo) {
      console.error('No refresh token and/or device info provided');
      res.status(401).json({ error: 'No refresh token and/or device info provided' });
      return;
    }

    // Sanitize deviceInfo fields to avoid prototype pollution and ensure only expected keys
    const safeDeviceInfo: DeviceInfo = {
      userAgent: typeof deviceInfo?.userAgent === 'string' ? deviceInfo.userAgent : (req.headers['user-agent'] ?? 'Unknown'),
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
      tokens = JSON.parse(user.refreshTokens ?? '[]');
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
      trustedDevices = JSON.parse(user.trustedIps ?? '[]');
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
      if (device.ip !== (req.ip ?? 'Unknown')) {
        logAuth(`[${user.username}] Device ${device.deviceInfo.clientId} switched IP: ${device.ip} -> ${req.ip}`, 'warn');
        device.ip = req.ip ?? 'Unknown';
      }

      // Update device info if provided
      if (safeDeviceInfo) {
        device.deviceInfo = { ...device.deviceInfo, ...safeDeviceInfo };
      }
    } else {
      await notify(dynamicStreams, 'login', {
        title: 'Suspicious Activity Detected',
        body: `Unauthorized activity detected from IP: ${req.ip}`,
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
      const trustedDevices: TrustedDevice[] = JSON.parse(user.trustedIps ?? '[]');
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
          const tokens = JSON.parse(user.refreshTokens ?? '[]');
          if (Array.isArray(tokens) && tokens.includes(refreshToken)) {
            const newTokens = tokens.filter((t: string) => t !== refreshToken);
            await prisma.user.update({
              where: { username: user.username },
              data: {
                refreshTokens: JSON.stringify(newTokens),
                trustedIps: JSON.stringify(
                  (JSON.parse(user.trustedIps ?? '[]') as TrustedDevice[])
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
}
