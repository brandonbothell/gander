import express from 'express';
import Greenlock from 'greenlock-express';
import path from 'path';
import config from '../config.json';

const app = express();

Greenlock.init({
  packageRoot: path.join(__dirname, '..'),
  configDir:
    config.greenlockConfigDir ?? path.join(__dirname, '..', 'greenlock.d'),
  maintainerEmail: config.maintainerEmail,
  cluster: false,
}).serve(app);

// Monitor console output for certificate renewal or timeout
let timeout: NodeJS.Timeout;

function resetTimeout() {
  if (timeout) clearTimeout(timeout);
  timeout = setTimeout(() => {
    console.log('No output for 40 seconds, terminating.');
    process.exit(0);
  }, 40000);
}

const originalLog = console.log;
console.log = (...args: any[]) => {
  originalLog.apply(console, args);
  const message = args.join(' ');
  if (message.startsWith('cert_renewal')) {
    console.log('Certificate renewal detected, terminating.');
    setTimeout(() => {
      console.log('No output for 40 seconds, terminating.');
      process.exit(0);
    }, 10000); // Wait 10 seconds to allow renewal to complete
  }
  resetTimeout();
};

// Start the timeout initially
resetTimeout();
