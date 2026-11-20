import path from 'path'
import fs from 'fs'
import cpy from 'cpy'

const distDir = path.resolve('web2', 'dist')

const manifest = JSON.parse(
  fs.readFileSync(path.resolve(distDir, 'manifest.json'), { encoding: 'utf8' }),
)
const version = manifest.version ?? '1.0.0'
const releaseDir = path.resolve('live-releases', version)

if (!fs.existsSync(releaseDir)) fs.mkdirSync(releaseDir, { recursive: true })

cpy('bundle.zip', path.resolve(releaseDir), { cwd: 'web2' })
cpy('bundle.sig', path.resolve(releaseDir), { cwd: 'web2' })
