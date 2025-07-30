import path from 'path';
import fs from 'fs';
import { exec, spawn } from 'child_process';
import { logMotion } from './logMotion';
import { setupStreamMotionMonitoring, stopStreamMotionMonitoring } from './camera';

export interface StreamConfig {
  id: string;
  hlsDir: string;
  recordDir: string;
  thumbDir: string;
  flushDir: string;
  ffmpegInput: string;
  rtspUser?: string;
  rtspPass?: string;
}

export class StreamManager {
  config: StreamConfig;
  ffmpeg: ReturnType<typeof spawn> | null = null;
  webrtcProcess: ReturnType<typeof spawn> | null = null;
  private webrtcClients = new Set<string>();
  private ffmpegRestarting = false;
  private ffmpegRestartTimestamps: number[] = [];
  private static readonly MAX_RESTARTS = 5;
  private static readonly RESTART_WINDOW_MS = 60 * 1000; // 1 minute
  private static readonly COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes
  private ffmpegCooldownUntil: number = 0;

  constructor(config: StreamConfig) {
    this.config = config;
    this.deleteHlsDir();
    [config.hlsDir, config.recordDir, config.thumbDir, config.flushDir].forEach(dir => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    });
  }

  private getRtspUrlWithAuth(): string {
    if (
      this.config.ffmpegInput.startsWith('rtsp://') &&
      this.config.rtspUser &&
      this.config.rtspPass
    ) {
      let url = this.config.ffmpegInput;

      // Use stream1 (main stream) but with reencoding for stability
      if (url.endsWith(':554') || url.endsWith(':554/')) {
        url = url.replace(/\/?$/, '/stream1'); // Main stream for better quality
      }

      return url.replace(
        /^rtsp:\/\//,
        `rtsp://${encodeURIComponent(this.config.rtspUser)}:${encodeURIComponent(this.config.rtspPass)}@`
      );
    }
    return this.config.ffmpegInput;
  }

  // Add client to WebRTC stream
  addWebRTCClient(clientId: string): boolean {
    if (this.webrtcClients.size === 0) {
      this.startWebRTCStream();
    }
    this.webrtcClients.add(clientId);
    console.info(`[${this.config.id}] WebRTC client ${clientId} added. Total clients: ${this.webrtcClients.size}`);
    return true;
  }

  // Remove client from WebRTC stream
  removeWebRTCClient(clientId: string): void {
    this.webrtcClients.delete(clientId);
    console.info(`[${this.config.id}] WebRTC client ${clientId} removed. Total clients: ${this.webrtcClients.size}`);

    if (this.webrtcClients.size === 0) {
      this.stopWebRTCStream();
    }
  }

  // Start WebRTC stream optimized for Pi 4
  private startWebRTCStream(): void {
    if (this.webrtcProcess) {
      console.info(`[${this.config.id}] WebRTC stream already running`);
      return;
    }

    const inputIsRtsp = this.config.ffmpegInput.startsWith('rtsp://');
    const inputUrl = inputIsRtsp ? this.getRtspUrlWithAuth() : this.config.ffmpegInput;

    const webrtcArgs = [
      '-y',
      '-fflags', '+genpts',
      '-analyzeduration', '1000000',
      '-probesize', '1000000',
      ...(inputIsRtsp
        ? ['-rtsp_transport', 'udp', '-i', inputUrl]
        : ['-f', 'v4l2', '-input_format', 'mjpeg', '-video_size', '640x360', '-framerate', '10', '-i', inputUrl]
      ),

      // Balanced encoding for WebRTC
      '-c:v', 'libx264',
      '-preset', 'faster',  // Less aggressive than ultrafast
      '-tune', 'zerolatency',
      '-profile:v', 'baseline',
      '-level', '3.0',
      '-pix_fmt', 'yuv420p',
      '-b:v', '400k',
      '-maxrate', '500k',
      '-bufsize', '1000k',
      '-g', '25',
      '-keyint_min', '25',
      '-x264opts', 'keyint=25:min-keyint=25:no-scenecut:threads=3', // More threads
      '-vf', 'scale=640:360',

      // Audio
      '-c:a', 'libopus',
      '-ar', '24000',
      '-ac', '1',
      '-b:a', '48k',

      // WebM output
      '-f', 'webm',
      '-deadline', 'realtime',
      '-cpu-used', '6', // Less aggressive than 8
      '-'
    ];

    console.info(`[${this.config.id}] Starting WebRTC stream...`);
    this.webrtcProcess = spawn('ffmpeg', webrtcArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false
    });

    this.webrtcProcess.stderr?.on('data', data => {
      const output = data.toString();
      if (output.includes('Error') || output.includes('Invalid')) {
        console.error(`[${this.config.id}] WebRTC FFmpeg Error: ${output}`);
      }
    });

    this.webrtcProcess.on('exit', (code, signal) => {
      console.info(`[${this.config.id}] WebRTC FFmpeg exited with code ${code} and signal ${signal}`);
      this.webrtcProcess = null;

      if (this.webrtcClients.size > 0 && code !== 0 && signal !== 'SIGTERM') {
        console.info(`[${this.config.id}] Restarting WebRTC stream...`);
        setTimeout(() => this.startWebRTCStream(), 2000);
      }
    });
  }

  private stopWebRTCStream(): void {
    if (this.webrtcProcess) {
      console.info(`[${this.config.id}] Stopping WebRTC stream...`);
      this.webrtcProcess.kill('SIGTERM');
      this.webrtcProcess = null;
    }
  }

  getWebRTCStream() {
    return this.webrtcProcess?.stdout;
  }

  isWebRTCActive(): boolean {
    return this.webrtcProcess !== null && this.webrtcClients.size > 0;
  }

  getWebRTCClientCount(): number {
    return this.webrtcClients.size;
  }

  // Main HLS stream - balanced for stability and performance
  startFFmpeg() {
    // --- Add cooldown check ---
    if (this.ffmpegCooldownUntil && Date.now() < this.ffmpegCooldownUntil) {
      logMotion(`[${this.config.id}] FFmpeg restart cooldown active. Next restart allowed at ${new Date(this.ffmpegCooldownUntil).toLocaleTimeString()}`, 'warn');
      return;
    }

    // --- Restart rate limiting logic ---
    const now = Date.now();
    this.ffmpegRestartTimestamps = this.ffmpegRestartTimestamps.filter(ts => now - ts < StreamManager.RESTART_WINDOW_MS);
    this.ffmpegRestartTimestamps.push(now);
    if (this.ffmpegRestartTimestamps.length > StreamManager.MAX_RESTARTS) {
      this.ffmpegCooldownUntil = now + StreamManager.COOLDOWN_MS;
      logMotion(`[${this.config.id}] Too many FFmpeg restarts (${this.ffmpegRestartTimestamps.length} in ${StreamManager.RESTART_WINDOW_MS / 1000}s). Entering cooldown for ${StreamManager.COOLDOWN_MS / 60000} minutes.`, 'error');
      return;
    }

    // CRITICAL: Clean the HLS directory before starting FFmpeg
    // This prevents segment number conflicts
    (async () => {
      try {
        const start = Date.now();
        const files = await fs.promises.readdir(this.config.hlsDir);
        const BATCH_SIZE = 100; // Delete in batches to avoid blocking
        for (let i = 0; i < files.length; i += BATCH_SIZE) {
          const batch = files.slice(i, i + BATCH_SIZE);
          await Promise.all(batch.map(file => {
            if (file.endsWith('.ts') || file.endsWith('.m3u8')) {
              return fs.promises.unlink(path.join(this.config.hlsDir, file)).catch(() => { });
            }
          }));
        }
        const elapsed = Date.now() - start;
        if (elapsed > 500) {
          console.warn(`[${this.config.id}] HLS directory cleanup took ${elapsed}ms`);
        }
        console.debug(`[${this.config.id}] Cleaned HLS directory: ${this.config.hlsDir}`);
      } catch (error) {
        console.warn(`[${this.config.id}] Could not clean HLS directory: ${error}`);
      }
    })();

    const inputIsRtsp = this.config.ffmpegInput.startsWith('rtsp://');
    const inputUrl = inputIsRtsp ? this.getRtspUrlWithAuth() : this.config.ffmpegInput;

    let ffmpegArgs: string[];

    if (inputIsRtsp) {
      // RTSP input - try stream copy first, fallback to reencoding
      ffmpegArgs = [
        '-y',
        '-fflags', '+genpts+discardcorrupt',
        '-rtsp_transport', 'udp',
        '-analyzeduration', '2000000',
        '-probesize', '2000000',
        '-i', inputUrl,

        // Try stream copy first for maximum performance
        '-c:v', 'copy',

        // Handle audio
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-c:a', 'aac',
        '-ar', '44100',
        '-ac', '2',
        '-b:a', '128k',

        // Better timestamp handling for stability
        '-avoid_negative_ts', 'make_zero',
        '-copyts',
        '-start_at_zero',
        '-muxdelay', '0',

        // HLS settings optimized for smooth playback
        '-f', 'hls',
        '-hls_time', '0.5', // Shorter segments for better responsiveness
        '-hls_list_size', '6',
        '-hls_flags', 'independent_segments',
        '-hls_segment_filename', path.join(this.config.hlsDir, 'segment_%03d.ts'),
        path.join(this.config.hlsDir, 'stream.m3u8')
      ];
    } else {
      // Local camera input (USB/V4L2)
      ffmpegArgs = [
        '-y',
        '-f', 'v4l2',
        '-input_format', 'mjpeg',
        '-video_size', '1280x720',
        '-framerate', '15', // Slightly higher for smoother motion
        '-i', inputUrl,

        // Balanced encoding
        '-c:v', 'libx264',
        '-preset', 'faster', // Better balance than veryfast
        '-tune', 'zerolatency',
        '-profile:v', 'main',
        '-level', '3.1',
        '-pix_fmt', 'yuv420p',
        '-b:v', '1000k',
        '-maxrate', '1200k',
        '-bufsize', '2400k',
        '-g', '30', // Longer GOP for stability
        '-x264opts', 'keyint=30:min-keyint=30:no-scenecut:threads=3',

        // No audio for most local cameras
        '-an',

        // HLS settings
        '-f', 'hls',
        '-hls_time', '0.5', // Shorter segments for better responsiveness
        '-hls_list_size', '6',
        '-hls_flags', 'independent_segments',
        '-hls_segment_filename', path.join(this.config.hlsDir, 'segment_%03d.ts'),
        path.join(this.config.hlsDir, 'stream.m3u8')
      ];
    }

    console.info(`[${this.config.id}] Starting FFmpeg with args:`, ffmpegArgs.join(' '));

    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'ignore', 'pipe'],
      shell: false
    });

    this.ffmpeg = ffmpegProcess; // Track the current process

    let hasErrored = false;
    let segmentCount = 0;
    let lastSegmentTime = Date.now();

    ffmpegProcess.stderr?.on('data', data => {
      const output = data.toString();

      // Count successful segment creation and track timing
      if (output.includes("Opening") && output.includes("/segment_")) {
        segmentCount++;
        const now = Date.now();
        const timeSinceLastSegment = now - lastSegmentTime;
        lastSegmentTime = now;

        // Log if segments are taking too long (indicates stuttering)
        if (segmentCount > 1 && timeSinceLastSegment > 10000) { // 10 seconds
          logMotion(`[${this.config.id}] Segment gap: ${timeSinceLastSegment}ms (restarting FFmpeg)`, 'warn');
          if (!this.ffmpegRestarting) {
            this.ffmpegRestarting = true;
            // --- Add cooldown check before restart ---
            if (this.ffmpegCooldownUntil && Date.now() < this.ffmpegCooldownUntil) {
              logMotion(`[${this.config.id}] FFmpeg restart cooldown active. Skipping restart.`, 'warn');
              return;
            }
            this.stopFFmpegAndWait().then(() => {
              this.ffmpegRestarting = false;
              setTimeout(() => this.startFFmpeg(), 1000);
            });
          }
        } else if (segmentCount > 1 && timeSinceLastSegment > 3000) {
          logMotion(`[${this.config.id}] Segment gap: ${timeSinceLastSegment}ms (possible stutter)`);
        }
      }

      // Only check for real errors that require reencoding
      if (inputIsRtsp && !hasErrored && segmentCount < 3) {
        const hasRealError = (
          output.includes('Connection refused') ||
          output.includes('Connection timed out') ||
          output.includes('No route to host') ||
          output.includes('401 Unauthorized') ||
          output.includes('403 Forbidden') ||
          output.includes('404 Not Found') ||
          output.includes('Invalid data found when processing input') ||
          output.includes('codec not currently supported in container') ||
          (output.includes('Packet corrupt') && !output.includes('DTS'))
        );

        if (hasRealError) {
          console.warn(`[${this.config.id}] Stream copy failed, switching to reencoding...`);
          hasErrored = true;
          if (!this.ffmpegRestarting) {
            this.ffmpegRestarting = true;
            this.stopFFmpegAndWait().then(() => {
              this.ffmpegRestarting = false;
              setTimeout(() => this.startFFmpegWithReencoding(), 1000);
            });
          }
          return;
        }
      }

      if (output.includes('Error') && !output.includes('Non-monotonous DTS')) {
        console.error(`[${this.config.id}] FFmpeg: ${output.trim()}`);
      }
    });

    // Robust exit handler
    ffmpegProcess.on('exit', (code, signal) => {
      // Only handle exit for the current process
      if (this.ffmpeg !== ffmpegProcess) return;
      this.ffmpeg = null;
      console.warn(`[${this.config.id}] FFmpeg exited with code ${code} and signal ${signal} (${segmentCount} segments created)`);
      // --- Add cooldown check before restart ---
      if (this.ffmpegCooldownUntil && Date.now() < this.ffmpegCooldownUntil) {
        logMotion(`[${this.config.id}] FFmpeg restart cooldown active. Skipping restart.`, 'warn');
        return;
      }
      // Only try reencoding if stream copy failed and we got no segments
      if (!hasErrored && inputIsRtsp && code !== 0 && (signal !== 'SIGTERM' && signal !== 'SIGKILL') && segmentCount === 0) {
        console.warn(`[${this.config.id}] Stream copy failed on exit, trying reencoding...`);
        hasErrored = true;
        if (!this.ffmpegRestarting) {
          this.ffmpegRestarting = true;
          this.stopFFmpegAndWait().then(() => {
            this.ffmpegRestarting = false;
            setTimeout(() => this.startFFmpegWithReencoding(), 1000);
          });
        }
      } else if (code !== 0 && signal !== 'SIGTERM') {
        // FFmpeg crashed or exited unexpectedly, restart
        logMotion(`[${this.config.id}] FFmpeg crashed or exited unexpectedly (code ${code}, signal ${signal}), restarting...`);
        if (!this.ffmpegRestarting) {
          this.ffmpegRestarting = true;
          this.stopFFmpegAndWait().then(() => {
            this.ffmpegRestarting = false;
            setTimeout(() => this.startFFmpeg(), 1000);
          });
        }
      }
    });
  }

  /**
   * Reconnects the stream:
   * - Calls stopStreamMotionMonitoring for this stream
   * - Kills all ffmpeg processes using this stream's HLS dir
   * - Cleans HLS and flush directories
   * - Restarts FFmpeg
   * - Calls setupStreamMotionMonitoring for this stream
   */
  async reconnect(): Promise<void> {
    const streamId = this.config.id;

    // 1. Stop motion monitoring and clear state
    try {
      await stopStreamMotionMonitoring(streamId);
      logMotion(`[${streamId}] Stopped stream motion monitoring`);
    } catch (e) {
      logMotion(`[${streamId}] Error stopping stream motion monitoring: ${e}`, 'warn');
    }

    // 2. Kill all ffmpeg processes for this stream (by matching hlsDir in command line)
    const killFFmpegPromise = new Promise<void>((resolve) => {
      // Also kill the managed ffmpeg process if still running
      this.ffmpeg?.kill('SIGKILL');
      this.ffmpeg = null;

      try {
        const hlsDir = this.config.hlsDir;
        if (process.platform === 'win32') {
          // Windows: use WMIC
          const searchStr = hlsDir.replace(/\\/g, '\\\\');
          exec(`wmic process where "CommandLine like '%${searchStr}%'" get ProcessId,CommandLine /FORMAT:CSV`, (err, stdout) => {
            if (!err && stdout) {
              const lines = stdout.split('\n').filter(l => l.toLowerCase().includes('ffmpeg'));
              for (const line of lines) {
                const match = line.match(/,ffmpeg.*?(\d+)\s*$/i);
                if (match) {
                  const pid = match[1];
                  logMotion(`[${streamId}] Killing ffmpeg process with PID ${pid} (matched by HLS dir)`);
                  try { process.kill(Number(pid), 'SIGKILL'); } catch { }
                }
              }
            }
            resolve();
          });
        } else {
          // Linux/macOS: use ps/grep/awk
          // Escape the hlsDir for grep (spaces, etc)
          const grepStr = hlsDir.replace(/(["'$`\\])/g, '\\$1');
          // Find all ffmpeg processes with the hlsDir in their command line
          exec(`ps -eo pid,command | grep '[f]fmpeg' | grep '${grepStr}' | awk '{print $1}'`, (err, stdout) => {
            if (!err && stdout) {
              const pids = stdout.split('\n').map(line => line.trim()).filter(Boolean);
              for (const pid of pids) {
                logMotion(`[${streamId}] Killing ffmpeg process with PID ${pid} (matched by HLS dir)`);
                try { process.kill(Number(pid), 'SIGKILL'); } catch { }
              }
            }
            resolve();
          });
        }
      } catch (e) {
        logMotion(`[${streamId}] Error killing ffmpeg processes: ${e}`, 'warn');
      }
    });

    await killFFmpegPromise;

    // 2.5. Wait a bit for OS/camera to release resources
    await new Promise(res => setTimeout(res, 1500)); // 1.5 seconds

    // 3. Clean HLS and flush directories
    try {
      if (fs.existsSync(this.config.hlsDir)) {
        fs.rmSync(this.config.hlsDir, { recursive: true, force: true });
        logMotion(`[${streamId}] Deleted HLS directory: ${this.config.hlsDir}`);
      }
      if (fs.existsSync(this.config.flushDir)) {
        fs.rmSync(this.config.flushDir, { recursive: true, force: true });
        logMotion(`[${streamId}] Deleted flush directory: ${this.config.flushDir}`);
      }
      // Recreate directories
      [this.config.hlsDir, this.config.flushDir].forEach(dir => {
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
      });
    } catch (e) {
      logMotion(`[${streamId}] Error cleaning directories: ${e}`, 'warn');
    }

    // 4. Restart FFmpeg
    try {
      this.startFFmpeg();
      logMotion(`[${streamId}] FFmpeg restarted via reconnect`);
    } catch (e) {
      logMotion(`[${streamId}] Error restarting FFmpeg: ${e}`, 'error');
    }

    // 5. Restart motion monitoring for this stream
    try {
      await setupStreamMotionMonitoring(streamId);
      logMotion(`[${streamId}] Motion monitoring re-initialized`);
    } catch (e) {
      logMotion(`[${streamId}] Error re-initializing motion monitoring: ${e}`, 'error');
    }
  }

  // Helper to stop FFmpeg and wait for exit before restarting
  private async stopFFmpegAndWait(): Promise<void> {
    return new Promise((resolve) => {
      if (!this.ffmpeg) return resolve();
      const proc = this.ffmpeg;
      let resolved = false;
      proc.once('exit', () => {
        if (!resolved) {
          resolved = true;
          this.ffmpeg = null;
          resolve();
        }
      });
      proc.kill('SIGKILL'); // Use SIGKILL for stubborn processes
      setTimeout(() => {
        if (!resolved) {
          resolved = true;
          this.ffmpeg = null;
          resolve();
        }
      }, 2000);
    });
  }

  // Fallback reencoding with balanced settings
  private startFFmpegWithReencoding() {
    console.info(`[${this.config.id}] Starting FFmpeg with reencoding...`);

    const inputUrl = this.getRtspUrlWithAuth();

    const ffmpegArgs = [
      '-y',
      '-fflags', '+genpts',
      '-rtsp_transport', 'udp',
      '-analyzeduration', '3000000',
      '-probesize', '3000000',
      '-i', inputUrl,

      // Balanced reencoding settings
      '-c:v', 'libx264',
      '-preset', 'faster', // Better balance than veryfast
      '-tune', 'zerolatency',
      '-profile:v', 'main',
      '-level', '3.1',
      '-pix_fmt', 'yuv420p',
      '-b:v', '800k',
      '-maxrate', '1000k',
      '-bufsize', '2000k',
      '-g', '30', // Longer GOP for stability
      '-x264opts', 'keyint=30:min-keyint=30:no-scenecut:threads=3',
      '-vf', 'scale=1280:720',

      // Audio handling
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-c:a', 'aac',
      '-ar', '44100',
      '-ac', '2',
      '-b:a', '128k',

      // Timestamp handling
      '-avoid_negative_ts', 'make_zero',
      '-vsync', 'cfr',

      // HLS settings
      '-f', 'hls',
      '-hls_time', '0.5', // Shorter segments for better responsiveness
      '-hls_list_size', '6',
      '-hls_flags', 'independent_segments',
      '-hls_segment_filename', path.join(this.config.hlsDir, 'segment_%03d.ts'),
      path.join(this.config.hlsDir, 'stream.m3u8')
    ];

    console.info(`[${this.config.id}] Reencoding FFmpeg args:`, ffmpegArgs.join(' '));

    this.ffmpeg = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'ignore', 'pipe'],
      shell: false
    });

    this.ffmpeg.stderr?.on('data', data => {
      const output = data.toString();
      if (!output.includes('frame=') &&
        !output.includes('bitrate=') &&
        !output.includes('speed=')) {
        console.info(`[${this.config.id}] FFmpeg (reencoded): ${output.trim()}`);
      }
    });

    this.ffmpeg.on('exit', (code, signal) => {
      this.ffmpeg = null; // Always clear reference on exit
      console.info(`[${this.config.id}] FFmpeg (reencoded) exited with code ${code} and signal ${signal}`);
    });
  }

  getPlaylistPath() {
    return path.join(this.config.hlsDir, 'stream.m3u8');
  }

  getSegmentPath(segment: string) {
    return path.join(this.config.hlsDir, segment);
  }

  deleteHlsDir() {
    if (fs.existsSync(this.config.hlsDir)) {
      fs.rmSync(this.config.hlsDir, { recursive: true, force: true });
    }
  }

  destroy() {
    this.stopWebRTCStream();
    this.ffmpeg?.kill('SIGTERM');
    this.webrtcClients.clear();
  }
}
