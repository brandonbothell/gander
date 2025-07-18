import path from 'path';
import fs from 'fs';
import { spawn } from 'child_process';

export interface StreamConfig {
  id: string;
  hlsDir: string;
  recordDir: string;
  thumbDir: string;
  ffmpegInput: string;
  rtspUser?: string;
  rtspPass?: string;
}

export class StreamManager {
  config: StreamConfig;
  ffmpeg: ReturnType<typeof spawn> | null = null;
  webrtcProcess: ReturnType<typeof spawn> | null = null;
  private webrtcClients = new Set<string>();

  constructor(config: StreamConfig) {
    this.config = config;
    this.deleteHlsDir();
    [config.hlsDir, config.recordDir, config.thumbDir].forEach(dir => {
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

      // Use stream2 (substream) for lower CPU usage
      if (url.endsWith(':554') || url.endsWith(':554/')) {
        url = url.replace(/\/?$/, '/stream2'); // Substream is lower resolution
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
    console.log(`[${this.config.id}] WebRTC client ${clientId} added. Total clients: ${this.webrtcClients.size}`);
    return true;
  }

  // Remove client from WebRTC stream
  removeWebRTCClient(clientId: string): void {
    this.webrtcClients.delete(clientId);
    console.log(`[${this.config.id}] WebRTC client ${clientId} removed. Total clients: ${this.webrtcClients.size}`);

    if (this.webrtcClients.size === 0) {
      this.stopWebRTCStream();
    }
  }

  // Start WebRTC stream optimized for Pi 4
  private startWebRTCStream(): void {
    if (this.webrtcProcess) {
      console.log(`[${this.config.id}] WebRTC stream already running`);
      return;
    }

    const inputIsRtsp = this.config.ffmpegInput.startsWith('rtsp://');
    const inputUrl = inputIsRtsp ? this.getRtspUrlWithAuth() : this.config.ffmpegInput;

    const webrtcArgs = [
      '-y',
      '-fflags', '+genpts',
      '-analyzeduration', '500000', // Reduced
      '-probesize', '500000',       // Reduced
      ...(inputIsRtsp
        ? ['-rtsp_transport', 'udp', '-i', inputUrl]
        : ['-f', 'v4l2', '-input_format', 'mjpeg', '-video_size', '640x360', '-framerate', '10', '-i', inputUrl]
      ),

      // Very aggressive encoding for WebRTC
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-profile:v', 'baseline',
      '-level', '3.0',
      '-pix_fmt', 'yuv420p',
      '-b:v', '300k',
      '-maxrate', '400k',
      '-bufsize', '800k',
      '-g', '20',
      '-keyint_min', '20',
      '-x264opts', 'keyint=20:min-keyint=20:no-scenecut:bframes=0:threads=2',
      '-vf', 'scale=480:270', // Very small for WebRTC

      // Minimal audio
      '-c:a', 'libopus',
      '-ar', '16000',
      '-ac', '1',
      '-b:a', '32k',

      // WebM output
      '-f', 'webm',
      '-deadline', 'realtime',
      '-cpu-used', '8', // Fastest VP8/VP9 encoding
      '-'
    ];

    console.log(`[${this.config.id}] Starting WebRTC stream...`);
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
      console.log(`[${this.config.id}] WebRTC FFmpeg exited with code ${code} and signal ${signal}`);
      this.webrtcProcess = null;

      if (this.webrtcClients.size > 0 && code !== 0 && signal !== 'SIGTERM') {
        console.log(`[${this.config.id}] Restarting WebRTC stream...`);
        setTimeout(() => this.startWebRTCStream(), 2000);
      }
    });
  }

  private stopWebRTCStream(): void {
    if (this.webrtcProcess) {
      console.log(`[${this.config.id}] Stopping WebRTC stream...`);
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

  // Main HLS stream - optimized for Pi 4 with 720p output
  startFFmpeg() {
    const inputIsRtsp = this.config.ffmpegInput.startsWith('rtsp://');
    const inputUrl = inputIsRtsp ? this.getRtspUrlWithAuth() : this.config.ffmpegInput;

    let ffmpegArgs: string[];

    if (inputIsRtsp) {
      // RTSP input - use substream and scale down for better performance
      ffmpegArgs = [
        '-y',
        '-fflags', '+genpts+discardcorrupt',
        '-rtsp_transport', 'udp',
        '-analyzeduration', '1000000', // Reduced
        '-probesize', '1000000',       // Reduced
        '-i', inputUrl,

        // Force reencoding with aggressive optimization for Pi 4
        '-c:v', 'libx264',
        '-preset', 'veryfast',   // Faster than 'faster'
        '-tune', 'zerolatency',
        '-profile:v', 'main',    // Better compression than baseline
        '-level', '3.1',
        '-pix_fmt', 'yuv420p',
        '-b:v', '600k',          // Lower bitrate
        '-maxrate', '800k',
        '-bufsize', '1600k',
        '-g', '25',              // Shorter GOP
        '-x264opts', 'keyint=25:min-keyint=25:no-scenecut:threads=2:sliced-threads=1',
        '-vf', 'scale=1280:720', // 720p output - still sharp but less CPU

        // Audio optimization
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-c:a', 'aac',
        '-ar', '22050',  // Lower sample rate
        '-ac', '1',      // Mono audio
        '-b:a', '64k',

        // Timestamp handling
        '-avoid_negative_ts', 'make_zero',
        '-vsync', 'cfr',

        // HLS settings - longer segments for less overhead
        '-f', 'hls',
        '-hls_time', '2',        // Back to 2 seconds
        '-hls_list_size', '6',
        '-hls_flags', 'independent_segments',
        '-hls_segment_filename', path.join(this.config.hlsDir, 'segment_%03d.ts'),
        path.join(this.config.hlsDir, 'stream.m3u8')
      ];
    } else {
      // Local camera input (USB/V4L2) - optimize for lower resolution
      ffmpegArgs = [
        '-y',
        '-f', 'v4l2',
        '-input_format', 'mjpeg',
        '-video_size', '1280x720', // Start with 720p input
        '-framerate', '12',        // Lower framerate
        '-i', inputUrl,

        // Encode for local camera
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-tune', 'zerolatency',
        '-profile:v', 'main',
        '-level', '3.1',
        '-pix_fmt', 'yuv420p',
        '-b:v', '800k',
        '-maxrate', '1000k',
        '-bufsize', '2000k',
        '-g', '25',
        '-x264opts', 'keyint=25:min-keyint=25:no-scenecut:threads=2',

        // No audio for most local cameras
        '-an',

        // HLS settings
        '-f', 'hls',
        '-hls_time', '2',
        '-hls_list_size', '6',
        '-hls_flags', 'independent_segments',
        '-hls_segment_filename', path.join(this.config.hlsDir, 'segment_%03d.ts'),
        path.join(this.config.hlsDir, 'stream.m3u8')
      ];
    }

    console.log(`[${this.config.id}] Starting FFmpeg with args:`, ffmpegArgs.join(' '));

    this.ffmpeg = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'ignore', 'pipe'],
      shell: false
    });

    let stderr = '';
    let segmentCount = 0;

    this.ffmpeg.stderr?.on('data', data => {
      const output = data.toString();
      stderr += output;

      // Count successful segment creation
      if (output.includes("Opening '/home/brandon/gander/hls_") && output.includes("/segment_")) {
        segmentCount++;
      }

      // Minimal logging for performance
      if (output.includes('Error') || output.includes('Invalid')) {
        console.log(`[${this.config.id}] FFmpeg Error: ${output.trim()}`);
      }
    });

    this.ffmpeg.on('exit', (code, signal) => {
      console.log(`[${this.config.id}] FFmpeg exited with code ${code} and signal ${signal} (${segmentCount} segments created)`);
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
