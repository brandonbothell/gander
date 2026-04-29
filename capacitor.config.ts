import '@dotenvx/dotenvx/config'
import type { CapacitorConfig } from '@capacitor/cli'
import localConfig from './config.json'

const config: CapacitorConfig & { clientId: string } = {
  appId: localConfig.appId,
  appName: localConfig.appName,
  webDir: './web/dist',
  clientId: process.env.CAPACITOR_CLIENT_ID ?? process.env.JWT_SECRET,
  server: {
    url: process.env.VITE_BASE_URL ?? 'http://localhost:3000',
    cleartext: process.env.CAPACITOR_ENV === 'development', // Allow cleartext traffic in development
  },
}

export default config
