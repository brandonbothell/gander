import path from 'node:path'
import fs from 'node:fs/promises'
import express from 'express'
import { rateLimit } from 'express-rate-limit'

const router = express.Router()
const RELEASES_DIR = path.resolve(process.cwd(), 'live-releases')

function compareSemVer(v1 = '1.0.0', v2 = '1.0.0') {
  const p1 = String(v1)
    .replace(/[^0-9.]/g, '')
    .split('.')
  const p2 = String(v2)
    .replace(/[^0-9.]/g, '')
    .split('.')
  const len = Math.max(p1.length, p2.length)

  for (let i = 0; i < len; i++) {
    const n1 = parseInt(p1[i] || '0', 10)
    const n2 = parseInt(p2[i] || '0', 10)
    if (n1 !== n2) return n1 > n2 ? 1 : -1
  }
  return 0
}

const bundleLimiter = rateLimit({
  validate: { ip: false },
  windowMs: 60 * 1000, // 1 minute
  max: 20,
  standardHeaders: true,
  legacyHeaders: false,
})

// 1. Serve static .zip bundles with immutable caching (since version folders never change)
router.use(
  '/bundles',
  bundleLimiter,
  express.static(RELEASES_DIR, {
    index: false,
    dotfiles: 'deny',
    maxAge: '365d',
    immutable: true,
    setHeaders: (res, filePath) => {
      // Only allow downloading .zip files via the static route
      if (!filePath.endsWith('.zip')) {
        res.status(403).end()
      }
    },
  }),
)

const checkLimiter = rateLimit({
  validate: { ip: false },
  windowMs: 60 * 1000, // 1 minute
  max: 48,
  standardHeaders: true,
  legacyHeaders: false,
})

router.post('/check', checkLimiter, express.json(), async (req, res) => {
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate')

  const { currentVersion = '1.0.0', nativeVersionCode = 0 } = req.body || {}
  const { base: baseUrl } = req.query

  try {
    const latestRaw = await fs.readFile(
      path.join(RELEASES_DIR, 'latest.manifest.json'),
      'utf8',
    )
    const latest = JSON.parse(latestRaw)

    // Gate by native APK versionCode so older binaries don't pull incompatible JS
    if (Number(nativeVersionCode) < Number(latest.minNativeVersionCode || 0)) {
      return res
        .status(200)
        .json({ updateAvailable: false, reason: 'native_upgrade_required' })
    }

    // Only offer an update if the latest release is strictly newer than the client
    if (compareSemVer(latest.version, currentVersion) <= 0) {
      return res.status(200).json({ updateAvailable: false })
    }

    // Read the pre-computed Base64 ECDSA signature for the version
    const sigPath = path.join(RELEASES_DIR, latest.version, 'bundle.sig')
    const signature = (await fs.readFile(sigPath, 'utf8')).trim()

    // Construct public HTTPS download URL
    const url = `${req.protocol}://${req.get('host')}/api/liveupdate/bundles/${encodeURIComponent(latest.version)}/bundle.zip`

    return res.status(200).json({
      updateAvailable: true,
      url,
      signature,
    })
  } catch (err) {
    console.error('[LiveUpdate] Failed to resolve update manifest:', err)
    return res.status(500).json({ error: 'Unable to check for updates' })
  }
})

export default router
