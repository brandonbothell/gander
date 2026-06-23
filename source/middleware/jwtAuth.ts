import os from 'os'
import jwt from 'jsonwebtoken'
import express from 'express'
import { JWT_SECRET } from '../credentials'
import { RequestWithUser } from '../camera'
import config from '../../config.json'

// --- JWT Middleware ---
export async function jwtAuth(
  req: RequestWithUser,
  res: express.Response,
  next: express.NextFunction,
) {
  const auth = req.headers.authorization
  if (!auth?.startsWith('Bearer ')) {
    // If bearer token is not present, check for API key
    if (!auth?.startsWith('ApiKey ')) {
      res.status(401).json({ error: 'Authentication required.' })
      return
    }

    const apiKey = auth.slice(7) // Use API key

    const user = config.users.find((user) => user.apiKeys?.includes(apiKey))
    if (!user) {
      res.status(401).json({ error: 'Invalid API key.' })
      return
    }

    if (config.restrictApiKeysToLocalNetwork) {
      const ip =
        'x-real-ip' in req.headers ? String(req.headers['x-real-ip']) : req.ip
      const isOnLocalNetwork = ip ? isLocalNetwork(ip) : false
      if (!isOnLocalNetwork) {
        res.status(403).json({ error: 'Invalid API key.' })
        return
      }
    }

    req.user = { username: user.username, isAdmin: user.isAdmin }
    next()
    return
  }
  try {
    // Use bearer token
    const payload = jwt.verify(auth.slice(7), JWT_SECRET) as {
      username: string
      isAdmin: boolean
    }
    req.user = payload

    next()
  } catch {
    res.status(401).json({ error: 'Invalid or expired token.' })
  }
}

/**
 * Helper to convert an IPv4 string to a 32-bit unsigned integer.
 */
function ipToLong(ip: string) {
  const cleanIp = ip.includes('::ffff:') ? ip.split('::ffff:')[1] : ip
  return (
    cleanIp
      .split('.')
      .reduce((ipInt, octet) => (ipInt << 8) + parseInt(octet, 10), 0) >>> 0
  )
}

/**
 * Helper to check if two IPv4 addresses share the same subnet mask.
 */
function isSameSubnet(ip1: string, ip2: string, netmask: string) {
  try {
    const bitmask = ipToLong(netmask)
    return (ipToLong(ip1) & bitmask) === (ipToLong(ip2) & bitmask)
  } catch (e) {
    return false
  }
}

/**
 * Checks if a given IP address belongs to the server's local networks.
 * @param {string} clientIp - The IP address string to check (e.g., req.ip)
 * @returns {boolean} True if the IP is local or loopback, false otherwise.
 */
function isLocalNetwork(clientIp: string) {
  if (!clientIp) return false

  // 1. Instantly approve loopback/localhost connections
  if (
    clientIp === '127.0.0.1' ||
    clientIp === '::1' ||
    clientIp === '::ffff:127.0.0.1'
  ) {
    return true
  }

  // Normalize IPv4-mapped IPv6 string for simple checks
  const hasIPv6Mapping = clientIp.includes('::ffff:')
  const cleanClientIp = hasIPv6Mapping ? clientIp.split('::ffff:')[1] : clientIp
  const isClientIPv6 = !hasIPv6Mapping && clientIp.includes(':')

  // 2. Fetch server network interfaces
  const interfaces = os.networkInterfaces()

  for (const interfaceName in interfaces) {
    for (const iface of interfaces[interfaceName] || []) {
      // Ignore loopback interfaces (handled above)
      if (iface.internal) continue

      // Handle IPv4 evaluation
      if (iface.family === 'IPv4' && !isClientIPv6) {
        if (isSameSubnet(cleanClientIp, iface.address, iface.netmask)) {
          return true
        }
      } else if (iface.family === 'IPv6' && isClientIPv6) {
        // Handle IPv6 evaluation
        if (iface.address === clientIp || clientIp.startsWith('fe80:')) {
          return true
        }
      }
    }
  }

  return false
}
