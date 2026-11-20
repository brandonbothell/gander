import path from 'path'
import fs from 'fs'

const distDir = path.resolve('web2', 'dist')

// 1. Write the authoritative manifest inside dist/ BEFORE zipping
const manifest = {
  version: process.env.CLIENT_REACT_APP_VERSION ?? '1.0.0',
  builtAt: new Date().toISOString(),
}

fs.writeFileSync(
  path.join(distDir, 'manifest.json'),
  JSON.stringify(manifest, null, 2),
)
