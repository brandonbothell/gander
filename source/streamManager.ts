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
      return this.config.ffmpegInput.replace(
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

  // Start WebRTC stream optimized for Raspberry Pi 4
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
      '-analyzeduration', '1000000',
      '-probesize', '1000000',
      ...(inputIsRtsp
        ? ['-rtsp_transport', 'udp', '-i', inputUrl]
        : ['-f', 'v4l2', '-input_format', 'mjpeg', '-video_size', '1280x720', '-framerate', '15', '-i', inputUrl]
      ),

      // Video encoding optimized for Pi 4
      '-c:v', 'libx264',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-profile:v', 'baseline',
      '-level', '3.1',
      '-pix_fmt', 'yuv420p',
      '-b:v', '500k',
      '-maxrate', '600k',
      '-bufsize', '1200k',
      '-g', '30',
      '-keyint_min', '30',
      '-x264opts', 'keyint=30:min-keyint=30:no-scenecut:bframes=0',
      '-vf', 'scale=640:360',

      // Audio encoding
      '-c:a', 'libopus',
      '-ar', '48000',
      '-ac', '1',
      '-b:a', '64k',

      // WebM output
      '-f', 'webm',
      '-deadline', 'realtime',
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

  // Main HLS stream - optimized for Raspberry Pi 4
  startFFmpeg() {
    const inputIsRtsp = this.config.ffmpegInput.startsWith('rtsp://');
    const inputUrl = inputIsRtsp ? this.getRtspUrlWithAuth() : this.config.ffmpegInput;

    let ffmpegArgs: string[];

    if (inputIsRtsp) {
      // RTSP input - try stream copy first with UDP for Tapo cameras
      ffmpegArgs = [
        '-y',
        '-fflags', '+genpts',
        '-rtsp_transport', 'udp',
        '-analyzeduration', '2000000',
        '-probesize', '2000000',
        '-i', inputUrl,

        // Try to copy video first
        '-c:v', 'copy',

        // Handle audio more carefully
        '-map', '0:v:0',
        '-map', '0:a:0?', // Optional audio mapping
        '-c:a', 'aac',
        '-ar', '44100',
        '-ac', '2',
        '-b:a', '128k',

        // Timestamp handling
        '-avoid_negative_ts', 'make_zero',

        // HLS settings - removed delete_segments
        '-f', 'hls',
        '-hls_time', '2',
        '-hls_list_size', '5',
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
        '-framerate', '15',
        '-i', inputUrl,

        // Encode for local camera
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-profile:v', 'baseline',
        '-level', '3.1',
        '-pix_fmt', 'yuv420p',
        '-b:v', '1000k',
        '-maxrate', '1200k',
        '-bufsize', '2400k',
        '-g', '30',
        '-x264opts', 'keyint=30:min-keyint=30:no-scenecut',

        // No audio for most local cameras
        '-an',

        // HLS settings - removed delete_segments
        '-f', 'hls',
        '-hls_time', '2',
        '-hls_list_size', '5',
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

    let hasErrored = false;
    let stderr = '';

    this.ffmpeg.stderr?.on('data', data => {
      const output = data.toString();
      stderr += output;

      // Log all stderr for debugging
      console.log(`[${this.config.id}] FFmpeg: ${output.trim()}`);

      // Check for stream copy issues with RTSP
      if (inputIsRtsp && !hasErrored && (
        output.includes('Non-monotonous DTS') ||
        output.includes('Application provided invalid') ||
        output.includes('Packet corrupt') ||
        output.includes('Invalid data found') ||
        output.includes('codec not currently supported in container')
      )) {
        console.log(`[${this.config.id}] Stream copy failed, switching to reencoding...`);
        hasErrored = true;
        this.ffmpeg?.kill();
        setTimeout(() => this.startFFmpegWithReencoding(), 1000);
        return;
      }
    });

    const handleFfmpegExit = (code: number | null, signal: NodeJS.Signals | null) => {
      console.log(`[${this.config.id}] FFmpeg exited with code ${code} and signal ${signal}`);

      if (stderr) {
        console.log(`[${this.config.id}] Full FFmpeg stderr:`, stderr);
      }

      if (!hasErrored && inputIsRtsp && code !== 0) {
        console.log(`[${this.config.id}] Stream copy failed on exit, trying reencoding...`);
        hasErrored = true;
        setTimeout(() => this.startFFmpegWithReencoding(), 1000);
      }
    };

    this.ffmpeg.addListener('exit', handleFfmpegExit);
    setTimeout(() => { this.ffmpeg?.removeListener('exit', handleFfmpegExit); }, 10000);
  }

  // Fallback with reencoding for problematic RTSP streams
  private startFFmpegWithReencoding() {
    console.log(`[${this.config.id}] Starting FFmpeg with reencoding...`);

    const inputUrl = this.getRtspUrlWithAuth();

    const ffmpegArgs = [
      '-y',
      '-fflags', '+genpts',
      '-rtsp_transport', 'udp',
      '-analyzeduration', '3000000',
      '-probesize', '3000000',
      '-i', inputUrl,

      // Force reencoding with Pi 4 optimized settings
      '-c:v', 'libx264',
      '-preset', 'faster',
      '-tune', 'zerolatency',
      '-profile:v', 'baseline',
      '-level', '3.1',
      '-pix_fmt', 'yuv420p',
      '-b:v', '800k',
      '-maxrate', '1000k',
      '-bufsize', '2000k',
      '-g', '30',
      '-x264opts', 'keyint=30:min-keyint=30:no-scenecut',
      '-vf', 'scale=1280:720',

      // Audio handling - only if audio stream exists
      '-map', '0:v:0',
      '-map', '0:a:0?',
      '-c:a', 'aac',
      '-ar', '44100',
      '-ac', '2',
      '-b:a', '128k',

      // Timestamp handling
      '-avoid_negative_ts', 'make_zero',
      '-vsync', 'cfr',

      // HLS settings - removed delete_segments
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_list_size', '5',
      '-hls_flags', 'independent_segments',
      '-hls_segment_filename', path.join(this.config.hlsDir, 'segment_%03d.ts'),
      path.join(this.config.hlsDir, 'stream.m3u8')
    ];

    console.log(`[${this.config.id}] Reencoding FFmpeg args:`, ffmpegArgs.join(' '));

    this.ffmpeg = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'ignore', 'pipe'],
      shell: false
    });

    this.ffmpeg.stderr?.on('data', data => {
      const output = data.toString();
      console.log(`[${this.config.id}] FFmpeg (reencoded): ${output.trim()}`);
    });

    this.ffmpeg.on('exit', (code, signal) => {
      console.log(`[${this.config.id}] FFmpeg (reencoded) exited with code ${code} and signal ${signal}`);
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
