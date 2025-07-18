import type { CapacitorConfig } from '@capacitor/cli';
import localConfig from './config.json'

const config: CapacitorConfig = {
  appId: localConfig.appId,
  appName: localConfig.appName,
  webDir: './web/dist',
  server: {
    url: localConfig.baseUrl,
    cleartext: false
  }
};

export default config;
