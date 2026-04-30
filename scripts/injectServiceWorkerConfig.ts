import path from 'path'
import fs from 'fs'

// Read from environment or a config file
const BASE_URL = process.env.VITE_BASE_URL || 'http://localhost:3000' // fallback

const swPath = path.resolve(__dirname, '../web/public/sw.js')
const outPath = path.resolve(__dirname, '../web/dist/sw.js')

// Read the source SW
let swSrc = fs.readFileSync(swPath, 'utf8')

// Replace the placeholder
swSrc = swSrc.replace(/__BASE_URL__/g, BASE_URL)

// Write to output directory
fs.writeFileSync(outPath, swSrc)

console.log(`Injected BASE_URL (${BASE_URL}) into service worker.`)
