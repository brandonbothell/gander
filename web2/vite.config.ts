import { createLogger, defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

console.log(import.meta.dirname)

const customLogger = createLogger()
const loggerWarnOnce = customLogger.warnOnce
customLogger.warnOnce = (msg, options) => {
  if (
    // TODO: Find an alternative to Vite
    msg.includes(
      'Using Yarn PnP with Vite is discouraged and PnP-specific bugs will no longer be actively worked on.',
    )
  ) {
    return
  }
  loggerWarnOnce(msg, options)
}

// https://vitejs.dev/config/
export default defineConfig(({ mode }) => ({
  plugins: [react()],
  ...(mode === 'development'
    ? {
        build: { manifest: true, sourcemap: true },
      }
    : {}),
  envPrefix: 'CLIENT_',
  customLogger,
}))
