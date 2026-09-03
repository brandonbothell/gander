import '@dotenvx/dotenvx/config';
import localConfig from './config.json';
const config = {
    appId: localConfig.appId,
    appName: localConfig.appName,
    webDir: './web/dist',
    server: {
        url: process.env.VITE_BASE_URL ?? 'http://localhost:3000',
        cleartext: process.env.CAPACITOR_ENV === 'development', // Allow cleartext traffic in development
    },
};
export default config;
