import jwt from 'jsonwebtoken'
import { getAppCheck } from 'firebase-admin/app-check'
import express, { Request, Response } from 'express'
import { doubleCsrf } from 'csrf-csrf'
import {
  DeviceInfo,
  TrustedDevice,
  getDeviceDisplayName,
} from '../types/deviceInfo'
import { StreamManager } from '../streamManager'
import { jwtAuth } from '../middleware/jwtAuth'
import { logAuth } from '../logMotion'
import { JWT_SECRET } from '../credentials'
import { prisma, RequestWithUser } from '../camera'
import config from '../../config.json'
import { notify } from './notifications'
import { rateLimit } from 'express-rate-limit'

export default function initializeAuthRoutes(
  app: express.Express,
  dynamicStreams: Record<string, StreamManager>,
) {
  const loginLimiter = rateLimit({
    validate: { ip: false },
    windowMs: 2 * 60 * 1000, // 2 minutes
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
  })

  const logoutLimiter = rateLimit({
    validate: { ip: false },
    windowMs: 2 * 60 * 1000, // 2 minutes
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
  })

  const refreshTokenLimiter = rateLimit({
    validate: { ip: false },
    windowMs: 30 * 60 * 1000, // 30 minutes
    max: 500,
    standardHeaders: true,
    legacyHeaders: false,
  })

  const sessionsLimiter = rateLimit({
    validate: { ip: false },
    windowMs: 30000, // 30 seconds
    max: 20,
    standardHeaders: true,
    legacyHeaders: false,
  })

  const {
    invalidCsrfTokenError, // This is just for convenience if you plan on making your own middleware.
    generateCsrfToken, // Use this in your routes to provide a CSRF token.
    validateRequest, // Also a convenience if you plan on making your own middleware.
    doubleCsrfProtection, // This is the default CSRF protection middleware.
  } = doubleCsrf({
    cookieName: 'x-csrf-token',
    cookieOptions: {
      secure: process.env.API_ENV !== 'development',
      expires: new Date(new Date().getTime() + 7 * 24 * 60 * 60 * 1000), // 7 days
    },
    getSecret: () => JWT_SECRET,
    getSessionIdentifier: (req) => req.session.id, // return the requests unique identifier
  })

  app.post('/api/login', loginLimiter, express.json(), loginEndpoint())

  function loginEndpoint() {
    return async (req: Request, res: Response) => {
      const {
        username,
        password,
        deviceInfo,
      }: { username: string; password: string; deviceInfo: DeviceInfo } =
        req.body

      const ip =
        'x-real-ip' in req.headers ? String(req.headers['x-real-ip']) : req.ip

      logAuth(
        `[Login] Attempting login as user '${username}' from IP: '${ip}'`,
        'warn',
      )

      if (!username || !password || !deviceInfo) {
        res.status(401).json({ success: false, message: 'Invalid credentials' })
        return
      }

      // Sanitize deviceInfo fields to avoid prototype pollution and ensure only expected keys
      const safeDeviceInfo: DeviceInfo = {
        userAgent:
          typeof deviceInfo?.userAgent === 'string'
            ? deviceInfo.userAgent
            : (req.headers['user-agent'] ?? 'Unknown'),
        platform:
          typeof deviceInfo?.platform === 'string'
            ? deviceInfo.platform
            : 'Unknown',
        vendor:
          typeof deviceInfo?.vendor === 'string'
            ? deviceInfo.vendor
            : 'Unknown',
        language:
          typeof deviceInfo?.language === 'string'
            ? deviceInfo.language
            : 'Unknown',
        timezone:
          typeof deviceInfo?.timezone === 'string'
            ? deviceInfo.timezone
            : 'Unknown',
        screen:
          typeof deviceInfo?.screen === 'string'
            ? deviceInfo.screen
            : 'Unknown',
        clientId:
          typeof deviceInfo?.clientId === 'string'
            ? deviceInfo.clientId
            : 'Unknown',
        appCheckToken: ['string', 'undefined'].includes(
          typeof deviceInfo?.appCheckToken,
        )
          ? deviceInfo.appCheckToken
          : 'Unknown',
      }

      logAuth(`[Login] Device info: ${JSON.stringify(safeDeviceInfo, null, 2)}`)

      logAuth(
        `[Login] User agent: '${safeDeviceInfo.userAgent}'\nClient ID: '${safeDeviceInfo.clientId}'`,
        'warn',
      )

      const refreshTokenExp = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60 // 7 days

      const configUserIndex = config.users.findIndex(
        (user) => user.username === username && user.password === password,
      )

      if (configUserIndex >= 0) {
        const configUser = config.users[configUserIndex]
        logAuth(
          `[Login] User '${configUser.username}' credentials verified succesfully from ${req.ip}`,
        )

        let isVerifiedMobile = false

        if (safeDeviceInfo.appCheckToken) {
          try {
            // Verifies the token and confirms MEETS_DEVICE_INTEGRITY
            await getAppCheck().verifyToken(safeDeviceInfo.appCheckToken)
            logAuth('[Login] Client succeeded mobile attestation')
            isVerifiedMobile = true
          } catch (err) {
            logAuth(
              '[Login] Client failed mobile attestation, returning 401',
              'warn',
            )
            return res
              .status(401)
              .json({ success: false, message: 'Invalid credentials' })
          }
        }

        const token = jwt.sign(
          { username, isAdmin: configUser.isAdmin, type: 'access' },
          JWT_SECRET,
          { expiresIn: '5m' },
        )
        const statusToken = jwt.sign({ username, type: 'status' }, JWT_SECRET, {
          expiresIn: '21d',
        })
        const refreshToken = jwt.sign(
          {
            username,
            type: 'refresh',
          },
          JWT_SECRET,
          { expiresIn: '7d' },
        )

        let user = await prisma.user.findUnique({
          where: { username },
          select: {
            trustedIps: true,
            username: true,
            jwts: true,
            refreshTokens: true,
            statusTokens: true,
            isAdmin: false,
          },
        })

        // Create user if not exists, or update tokens if exists
        if (!user) {
          const newDevice = {
            ip,
            deviceInfo: safeDeviceInfo,
            firstSeen: new Date().toISOString(),
            lastSeen: new Date().toISOString(),
            loginCount: 1,
          }

          user = await prisma.user.create({
            data: {
              username,
              jwts: JSON.stringify([token]),
              refreshTokens: JSON.stringify([refreshToken]),
              statusTokens: JSON.stringify([statusToken]),
              trustedIps: JSON.stringify([newDevice]),
              isAdmin: configUser.isAdmin ?? false,
            },
          })
        } else {
          // Update existing user
          let trustedDevices: TrustedDevice[] = []
          try {
            trustedDevices = JSON.parse(user.trustedIps ?? '[]')
          } catch {
            trustedDevices = []
          }

          // Find existing device or create new one
          // const ipIsTrusted = trustedDevices.some((device) => device.ip === ip)
          const existingDeviceIndex = trustedDevices.findIndex(
            (device) => device.deviceInfo.clientId === safeDeviceInfo.clientId,
          )
          const now = new Date().toISOString()

          if (existingDeviceIndex >= 0) {
            await notify(
              dynamicStreams,
              'login',
              {
                title: 'Login Detected',
                body: `A trusted ${getDeviceDisplayName(safeDeviceInfo)} device logged in from IP address: ${ip}`,
                group: 'security_event',
              },
              username,
            )

            // Existing device - update info
            const device = trustedDevices[existingDeviceIndex]
            device.lastSeen = now
            device.loginCount++

            // Update IP if it changed (network switching)
            if (device.ip !== (ip ?? 'Unknown')) {
              logAuth(
                `[Login] [${user.username}] Device ${device.deviceInfo.clientId} switched IP: ${device.ip} -> ${ip}`,
                'warn',
              )
              device.ip = ip ?? 'Unknown'
            }

            // Update device info if provided
            if (safeDeviceInfo) {
              device.deviceInfo = { ...device.deviceInfo, ...safeDeviceInfo }
            }
          } else {
            await notify(
              dynamicStreams,
              'login',
              {
                title: 'New Browser/Device Detected',
                body: `A login from a new ${getDeviceDisplayName(safeDeviceInfo)} client was detected from IP: ${ip}`,
                group: 'security_event',
              },
              user.username,
            )
            trustedDevices.push({
              ip: ip ?? 'Unknown',
              deviceInfo: safeDeviceInfo,
              firstSeen: now,
              lastSeen: now,
              loginCount: 1,
            })
          }

          await prisma.user.update({
            where: { username },
            data: {
              jwts: JSON.stringify(
                Array.from(new Set([...JSON.parse(user.jwts), token])),
              ),
              refreshTokens: JSON.stringify(
                Array.from(
                  new Set([...JSON.parse(user.refreshTokens), refreshToken]),
                ),
              ),
              statusTokens: JSON.stringify(
                Array.from(
                  new Set([...JSON.parse(user.statusTokens), statusToken]),
                ),
              ),
              trustedIps: JSON.stringify(trustedDevices),
            },
          })
        }

        res.cookie('_rt', refreshToken, {
          httpOnly: true,
          secure: process.env.API_ENV !== 'development',
          expires: new Date(refreshTokenExp * 1000),
        })

        res.cookie('_rtexists', '1', {
          secure: process.env.API_ENV !== 'development',
          expires: new Date(refreshTokenExp * 1000),
        })

        logAuth(
          `[Login] User ${username} logged in successfully from IP: ${ip}`,
          'warn',
        )

        res.json({
          success: true,
          token,
          ...(isVerifiedMobile ? { refreshToken } : {}),
          statusToken,
          csrfToken: generateCsrfToken(req, res),
        })
      } else {
        setTimeout(
          () =>
            res
              .status(401)
              .json({ success: false, message: 'Invalid credentials' }),
          1000,
        )
      }
    }
  }

  app.post(
    '/api/refresh-token',
    doubleCsrfProtection,
    refreshTokenLimiter,
    refreshTokenEndpoint({ mobile: false }),
  )
  // Mobile doesn't need CSRF prevention due to requiring an app check token
  app.post(
    '/api/mobile/refresh-token',
    refreshTokenLimiter,
    refreshTokenEndpoint({ mobile: true }),
  )

  function refreshTokenEndpoint({ mobile }: { mobile: boolean }) {
    return async (req: Request, res: Response) => {
      let refreshToken = req.headers['refresh-token'] ?? req.cookies['_rt']

      if (refreshToken) {
        logAuth('[Refresh Token] Refresh token retrieved from cookie/header')
      } else {
        logAuth('[Refresh Token] No refresh token provided', 'error')
        res.status(401).json({ error: 'No refresh token provided' })
        return
      }

      let payload: {
        username: string
        type: string
      }

      try {
        payload = jwt.verify(refreshToken, JWT_SECRET) as {
          username: string
          type: string
        }

        if (payload.type !== 'refresh') {
          logAuth('[Refresh Token] Invalid token type', 'error')
          res.status(401).json({ error: 'Invalid token provided' })
          return
        }
      } catch (err) {
        logAuth(
          `[Refresh Token] Invalid or expired refresh token: ${err}`,
          'error',
        )
        res.status(401).json({ error: 'Invalid token provided' })
        return
      }

      const { deviceInfo }: { deviceInfo?: DeviceInfo } = req.body

      if (!deviceInfo) {
        logAuth('[Refresh Token] No device info provided', 'error')
        res.status(401).json({ error: 'Invalid token provided' })
        return
      }

      // Sanitize deviceInfo fields to avoid prototype pollution and ensure only expected keys
      const safeDeviceInfo: DeviceInfo = {
        userAgent:
          typeof deviceInfo?.userAgent === 'string'
            ? deviceInfo.userAgent
            : (req.headers['user-agent'] ?? 'Unknown'),
        platform:
          typeof deviceInfo?.platform === 'string'
            ? deviceInfo.platform
            : 'Unknown',
        vendor:
          typeof deviceInfo?.vendor === 'string'
            ? deviceInfo.vendor
            : 'Unknown',
        language:
          typeof deviceInfo?.language === 'string'
            ? deviceInfo.language
            : 'Unknown',
        timezone:
          typeof deviceInfo?.timezone === 'string'
            ? deviceInfo.timezone
            : 'Unknown',
        screen:
          typeof deviceInfo?.screen === 'string'
            ? deviceInfo.screen
            : 'Unknown',
        clientId:
          typeof deviceInfo?.clientId === 'string'
            ? deviceInfo.clientId
            : 'Unknown',
        appCheckToken: ['string', 'undefined'].includes(
          typeof deviceInfo?.appCheckToken,
        )
          ? deviceInfo.appCheckToken
          : 'Unknown',
      }

      // Find the user whose refreshTokens array contains the given refreshToken
      const user = await prisma.user.findUnique({
        where: { username: payload.username },
      })
      const hasRefreshToken = user
        ? JSON.parse(user.refreshTokens).includes(refreshToken)
        : false

      if (!hasRefreshToken || !user) {
        logAuth(
          `[Refresh Token] Refresh token not found for any user: ${refreshToken}`,
          'error',
        )
        logAuth(
          `[Refresh Token] Bad Refresh Request Headers: ${JSON.stringify(req.headers, null, 2)}`,
        )
        res.status(401).json({ error: 'Invalid token provided' })
        return
      }

      const ip =
        'x-real-ip' in req.headers ? String(req.headers['x-real-ip']) : req.ip

      logAuth(
        `[Refresh Token] User ${user.username} refreshing token from IP: ${ip}`,
      )

      let isVerifiedMobile = false

      if (mobile) {
        if (safeDeviceInfo.appCheckToken) {
          try {
            // Cryptographically verifies the token and confirms MEETS_DEVICE_INTEGRITY
            await getAppCheck().verifyToken(safeDeviceInfo.appCheckToken)
            logAuth('[Refresh Token] Client succeeded mobile attestation')
            isVerifiedMobile = true
          } catch (err) {
            logAuth(
              '[Refresh Token] Client failed mobile attestation, returning 401',
              'warn',
            )
            return res.status(401).json({ error: 'Invalid token provided' })
          }
        } else {
          logAuth(
            `[Refresh Token] User ${user.username} failed to provide an app check token in a mobile refresh request`,
            'warn',
          )
          return res.status(401).json({ error: 'Invalid token provided' })
        }
      }

      let refreshTokens: string[] = []
      let jwts: string[] = []
      let statusTokens: string[] = []
      try {
        refreshTokens = JSON.parse(user.refreshTokens ?? '[]')
        jwts = JSON.parse(user.jwts ?? '[]')
        statusTokens = JSON.parse(user.statusTokens ?? '[]')
      } catch (_) {
        logAuth(`Failed to parse tokens for user: ${user.username}`, 'error')
        res.status(500).json({ error: 'Failed to parse tokens' })
        return
      }

      const newRefreshToken = (() => {
        let newRefreshToken
        while (!newRefreshToken || refreshTokens.includes(newRefreshToken)) {
          newRefreshToken = jwt.sign(
            {
              username: user.username,
              type: 'refresh',
            },
            JWT_SECRET,
            { expiresIn: '7d' },
          )
        }

        refreshTokens.push(newRefreshToken)
        return newRefreshToken
      })()

      if (!newRefreshToken) {
        logAuth(
          `Failed to generate new refresh token for user: ${user.username}`,
          'error',
        )
        res.status(500).json({ error: 'Failed to generate new refresh token' })
        return
      }

      let trustedDevices: TrustedDevice[] | null = null

      // Update trusted devices
      try {
        trustedDevices = JSON.parse(user.trustedIps ?? '[]') as TrustedDevice[]
      } catch {
        trustedDevices = []
      }

      // const ipIsTrusted = trustedDevices.some((device) => device.ip === ip)
      const existingDeviceIndex = trustedDevices.findIndex(
        (device) => device.deviceInfo.clientId === safeDeviceInfo.clientId,
      )
      const now = new Date().toISOString()

      if (existingDeviceIndex >= 0) {
        // Existing device - update info
        const device = trustedDevices[existingDeviceIndex]
        device.lastSeen = now
        device.loginCount++

        // Update IP if it changed (network switching)
        if (device.ip !== (ip ?? 'Unknown')) {
          logAuth(
            `[${user.username}] Device ${device.deviceInfo.clientId} switched IP: ${device.ip} -> ${ip}`,
            'warn',
          )
          logAuth(
            `[Refresh Token] IP Change Device Info for ${user.username}: ${JSON.stringify(safeDeviceInfo, null, 2)}`,
          )
          device.ip = ip ?? 'Unknown'
        }

        // Update device info if provided
        if (safeDeviceInfo) {
          device.deviceInfo = { ...device.deviceInfo, ...safeDeviceInfo }
        }
      } else {
        await notify(
          dynamicStreams,
          'login',
          {
            title: 'Suspicious Activity Detected',
            body: `Unauthorized activity detected from IP: ${ip}`,
            group: 'security_event',
          },
          user.username,
        )
        res.status(403).json({ error: 'Unauthorized activity detected' })
        logAuth(
          `[${user.username}] Unauthorized activity detected from IP: ${ip}`,
          'error',
        )
        logAuth(
          `[Refresh Token] Unauthorized Refresh Request Headers for ${user.username}: ${JSON.stringify(req.headers, null, 2)}`,
        )
        return
      }

      const token = jwt.sign(
        { username: user.username, isAdmin: user.isAdmin, type: 'access' },
        JWT_SECRET,
        {
          expiresIn: '5m',
        },
      )
      const currentStatusToken = statusTokens.find((t) => {
        try {
          // Check if the status token is valid for at least 10 more days
          const decoded = jwt.decode(t) as {
            username: string
            type: string
            exp?: number
          } | null
          if (
            decoded &&
            decoded.type === 'status' &&
            decoded.exp! * 1000 > Date.now() + 10 * 24 * 60 * 60 * 1000
          ) {
            return true
          } else {
            return false
          }
        } catch (err) {
          logAuth(
            `[Refresh Token] Failed to decode status token for user ${user.username}: ${err}`,
            'error',
          )
        }

        return false
      })

      const statusToken =
        currentStatusToken ??
        jwt.sign({ username: user.username, type: 'status' }, JWT_SECRET, {
          expiresIn: '21d',
        })

      jwts.push(token)
      if (!currentStatusToken) statusTokens.push(statusToken)
      else {
        logAuth(
          `[Refresh Token] Reusing existing status token for user ${user.username}`,
        )
      }

      await prisma.user.update({
        where: { username: user.username },
        data: {
          refreshTokens: JSON.stringify(
            refreshTokens.filter((t) => t !== refreshToken),
          ), // Remove old refresh token
          statusTokens: JSON.stringify(statusTokens),
          jwts: JSON.stringify(jwts),

          ...(trustedDevices
            ? { trustedIps: JSON.stringify(trustedDevices) }
            : {}),
        },
      })

      res.cookie('_rt', newRefreshToken, {
        httpOnly: true,
        secure: process.env.API_ENV !== 'development',
        expires: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000), // 7 days
      })

      res.json({
        success: true,
        ...(isVerifiedMobile
          ? { refreshToken: newRefreshToken }
          : // Only regenerate the CSRF token for web clients on refresh, since it's not implemented on mobile yet.
            { csrfToken: generateCsrfToken(req, res, { overwrite: true }) }),
        token,
        statusToken,
      })
    }
  }

  app.get(
    '/api/user/sessions',
    sessionsLimiter,
    jwtAuth,
    async (req: RequestWithUser, res) => {
      const username = req.user!.username
      const user = await prisma.user.findUnique({
        where: { username },
        select: { trustedIps: true },
      })

      if (!user) {
        res.json([])
        return
      }

      try {
        const trustedDevices: TrustedDevice[] = JSON.parse(
          user.trustedIps ?? '[]',
        )
        res.json(trustedDevices)
      } catch {
        res.json([])
      }
    },
  )
  app.post('/api/logout', logoutLimiter, async (req, res) => {
    let refreshToken = req.cookies['_rt']
    if (refreshToken) {
      logAuth('[Logout] Refresh token retrieved from cookie')
    } else {
      logAuth('[Logout] No refresh token provided', 'warn')
      res.status(401).json({ error: 'No refresh token provided' })
      return
    }

    const { clientId }: { clientId?: string } = req.body

    res.clearCookie('_rt').clearCookie('_rtexists')

    let payload: { username: string; type: string }

    try {
      payload = jwt.verify(refreshToken, JWT_SECRET) as any
    } catch {
      res.status(401).json({ error: 'Invalid refresh token' })
      return
    }
    // Remove the refreshToken from the user's refreshTokens array
    const user = await prisma.user.findUnique({
      where: { username: payload.username },
    })

    if (!user) {
      res.status(401).send({ error: 'User no longer exists' })
      return
    }

    try {
      const tokens = JSON.parse(user.refreshTokens ?? '[]')
      if (Array.isArray(tokens) && tokens.includes(refreshToken)) {
        const newTokens = tokens.filter((t: string) => t !== refreshToken)
        await prisma.user.update({
          where: { username: user.username },
          data: {
            refreshTokens: JSON.stringify(newTokens),
          },
        })

        const ip =
          'x-real-ip' in req.headers ? String(req.headers['x-real-ip']) : req.ip
        logAuth(`[Logout] User ${user.username} logged out from IP: ${ip}`)
        res.json({ success: true })
        return
      }
    } catch {
      logAuth(
        `Failed to parse refreshTokens for user ${user.username}, skipping logout.`,
        'error',
      )
      res.status(500).json({ error: 'Failed to logout' })
    }
  })
}
