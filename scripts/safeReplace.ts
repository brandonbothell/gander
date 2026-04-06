import fs from 'fs';
import path from 'path';

async function safeReplace() {
  const tempDir = path.join(__dirname, '..', 'compiled-temp');
  const targetDir = path.join(__dirname, '..', 'compiled');
  const backupDir = path.join(__dirname, '..', 'compiled-backup');

  try {
    console.log('Starting safe replacement...');

    // Check if server is running by looking for a process using the compiled files
    const { exec } = require('child_process');
    const isRunning = await new Promise((resolve) => {
      exec(
        'lsof compiled/camera.js 2>/dev/null || pgrep -f "compiled/camera.js"',
        (error: any) => {
          resolve(!error); // If no error, process is running
        },
      );
    });

    if (isRunning) {
      console.log('Server appears to be running, using atomic replacement...');

      // Create backup
      if (fs.existsSync(targetDir)) {
        if (fs.existsSync(backupDir)) {
          fs.rmSync(backupDir, { recursive: true, force: true });
        }
        fs.renameSync(targetDir, backupDir);
      }

      // Atomic move
      fs.renameSync(tempDir, targetDir);

      // Clean up backup after successful move
      if (fs.existsSync(backupDir)) {
        fs.rmSync(backupDir, { recursive: true, force: true });
      }

      console.log('Safe replacement completed');
    } else {
      console.log('Server not running, doing direct replacement...');

      // Direct replacement when server isn't running
      if (fs.existsSync(targetDir)) {
        fs.rmSync(targetDir, { recursive: true, force: true });
      }
      fs.renameSync(tempDir, targetDir);

      console.log('Direct replacement completed');
    }
  } catch (error) {
    console.error('Error during safe replacement:', error);

    // Restore from backup if it exists
    if (fs.existsSync(backupDir) && !fs.existsSync(targetDir)) {
      console.log('Restoring from backup...');
      fs.renameSync(backupDir, targetDir);
    }

    // Clean up temp directory
    if (fs.existsSync(tempDir)) {
      fs.rmSync(tempDir, { recursive: true, force: true });
    }

    process.exit(1);
  }
}

safeReplace();
