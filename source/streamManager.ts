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

  // Start WebRTC stream using FFmpeg with WebM/VP8 output for WebRTC compatibility
  private startWebRTCStream(): void {
    if (this.webrtcProcess) {
      console.log(`[${this.config.id}] WebRTC stream already running`);
      return;
    }

    const inputIsRtsp = this.config.ffmpegInput.startsWith('rtsp://');
    const inputUrl = inputIsRtsp ? this.getRtspUrlWithAuth() : this.config.ffmpegInput;
    const inputArgs = inputIsRtsp
      ? ['-rtsp_transport', 'udp', '-i', inputUrl]
      : ['-f', 'dshow', '-i', inputUrl];

    // Ultra low-latency WebRTC encoding
    const webrtcArgs = [
      ...inputArgs,
      '-fflags', '+genpts+nobuffer+flush_packets',
      '-rtbufsize', '100M',
      '-probesize', '32',
      '-analyzeduration', '0',

      // Video encoding for WebRTC
      '-c:v', 'libvpx',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      '-profile:v', '0', // Baseline profile for VP8
      '-quality', 'realtime',
      '-cpu-used', '8', // Fastest encoding
      '-deadline', 'realtime',
      '-g', '30', // Keyframe interval
      '-keyint_min', '30',
      '-b:v', '1000k', // 1Mbps video bitrate
      '-maxrate', '1200k',
      '-bufsize', '2000k',
      '-pix_fmt', 'yuv420p',

      // Audio encoding
      '-c:a', 'libopus',
      '-ar', '48000',
      '-ac', '2',
      '-b:a', '128k',

      // WebM output format suitable for WebRTC
      '-f', 'webm',
      '-cluster_size_limit', '2M',
      '-cluster_time_limit', '5100',
      '-'
    ];

    console.log(`[${this.config.id}] Starting WebRTC stream...`);
    this.webrtcProcess = spawn('ffmpeg', webrtcArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
      shell: false
    });

    this.webrtcProcess.stderr?.on('data', data => {
      const output = data.toString();
      // Filter out common warnings
      if (output.includes('SEI type') ||
        output.includes('No audio streams found') ||
        output.includes('Stream map')) {
        return;
      }
      // Uncomment for debugging
      // console.error(`[${this.config.id}] WebRTC FFmpeg: ${output}`);
    });

    this.webrtcProcess.on('exit', (code, signal) => {
      console.log(`[${this.config.id}] WebRTC FFmpeg exited with code ${code} and signal ${signal}`);
      this.webrtcProcess = null;

      // Restart if clients are still connected and exit was unexpected
      if (this.webrtcClients.size > 0 && code !== 0 && signal !== 'SIGTERM') {
        console.log(`[${this.config.id}] Restarting WebRTC stream...`);
        setTimeout(() => this.startWebRTCStream(), 2000);
      }
    });
  }

  // Stop WebRTC stream
  private stopWebRTCStream(): void {
    if (this.webrtcProcess) {
      console.log(`[${this.config.id}] Stopping WebRTC stream...`);
      this.webrtcProcess.kill('SIGTERM');
      this.webrtcProcess = null;
    }
  }

  // Get WebRTC stream data
  getWebRTCStream() {
    return this.webrtcProcess?.stdout;
  }

  // Check if WebRTC stream is active
  isWebRTCActive(): boolean {
    return this.webrtcProcess !== null && this.webrtcClients.size > 0;
  }

  // Get WebRTC client count
  getWebRTCClientCount(): number {
    return this.webrtcClients.size;
  }

  // Existing HLS methods...
  startFFmpeg() {
    // Use different FFmpeg input for RTSP or DirectShow
    const inputIsRtsp = this.config.ffmpegInput.startsWith('rtsp://');
    const inputUrl = inputIsRtsp ? this.getRtspUrlWithAuth() : this.config.ffmpegInput;
    const inputArgs = inputIsRtsp
      ? ['-rtsp_transport', 'udp', '-i', inputUrl]
      : ['-f', 'dshow', '-use_wallclock_as_timestamps', '1', '-i', inputUrl];

    // Custom settings for RTSP streams - try stream copy first
    let ffmpegArgs: string[];
    if (inputIsRtsp) {
      // Try stream copy with SEI filtering - minimal processing
      ffmpegArgs = [
        ...inputArgs,
        '-fflags', '+genpts+igndts+nobuffer+flush_packets',
        '-rtbufsize', '100M', // Reduced buffer size
        '-probesize', '32',
        '-analyzeduration', '0',
        // Low latency encoding settings
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-profile:v', 'baseline',
        '-level', '3.0',
        '-pix_fmt', 'yuv420p',
        '-x264opts', 'keyint=30:min-keyint=30:scenecut=-1',
        // Audio settings
        '-c:a', 'aac',
        '-ar', '44100',
        '-ac', '2',
        '-b:a', '128k',
        // HLS low-latency settings
        '-f', 'hls',
        '-hls_time', '0.5', // Reduced from 2 seconds
        '-hls_list_size', '4', // Increased slightly for stability
        '-hls_flags', 'program_date_time+independent_segments',
        '-hls_segment_type', 'mpegts',
        '-hls_delete_threshold', '4',
        '-segment_list_flags', 'live',
        '-hls_segment_filename', path.join(this.config.hlsDir, 'segment_%03d.ts'),
        path.join(this.config.hlsDir, 'stream.m3u8')
      ];
    } else {
      // For local webcam, we may need to encode since it's likely raw
      ffmpegArgs = [
        ...inputArgs,
        '-fflags', '+genpts+nobuffer+flush_packets',
        '-framerate', '30',
        '-video_size', '1280x720',
        // Minimal encoding delay
        '-c:v', 'libx264',
        '-preset', 'ultrafast',
        '-tune', 'zerolatency',
        '-profile:v', 'baseline',
        '-pix_fmt', 'yuv420p',
        '-x264opts', 'keyint=15:min-keyint=15:scenecut=-1:bframes=0',
        '-g', '15', // GOP size
        '-c:a', 'aac',
        '-ar', '44100',
        '-ac', '2',
        '-b:a', '128k',
        // Ultra low-latency HLS
        '-f', 'hls',
        '-hls_time', '0.33', // ~333ms segments
        '-hls_list_size', '6',
        '-hls_flags', 'program_date_time+independent_segments',
        '-hls_delete_threshold', '6',
        '-segment_list_flags', 'live',
        '-hls_segment_filename', path.join(this.config.hlsDir, 'segment_%03d.ts'),
        path.join(this.config.hlsDir, 'stream.m3u8')
      ];
    }

    this.ffmpeg = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      shell: false
    });

    // Enhanced error handling with fallback to reencoding
    let hasErrored = false;
    this.ffmpeg.stderr?.on('data', data => {
      const output = data.toString();

      // Filter out the SEI warning since we're now handling it
      if (output.includes('SEI type') && output.includes('truncated')) {
        return; // Ignore these warnings
      }

      // Also filter out common audio warnings that are harmless
      if (output.includes('Stream map \'0:a:0\' matches no streams') ||
        output.includes('No audio streams found')) {
        console.log(`[${this.config.id}] No audio stream detected, continuing with video only`);
        return;
      }

      // Check for compatibility issues that require reencoding
      if (inputIsRtsp && !hasErrored && (
        output.includes('Codec not currently supported in container') ||
        output.includes('Invalid data found when processing input') ||
        output.includes('Could not find codec parameters') ||
        output.includes('Non-monotonous DTS') ||
        output.includes('Application provided invalid, non monotonically increasing dts') ||
        output.includes('Bitstream filter') // BSF filter failed
      )) {
        console.log(`[${this.config.id}] Stream copy with filtering failed, falling back to reencoding...`);
        hasErrored = true;
        this.ffmpeg?.kill();
        this.startFFmpegWithReencoding();
        return;
      }

      // Uncomment for debugging
      // if (this.config.id === 'cam2') console.error(`[${this.config.id}] FFmpeg: ${output}`);
    });

    const handleFfmpegExit = (code: number | null, signal: NodeJS.Signals | null) => {
      console.log(`[${this.config.id}] FFmpeg exited with code ${code} and signal ${signal}`);

      // If it exits immediately and we haven't tried reencoding yet, try reencoding
      if (!hasErrored && inputIsRtsp && code !== 0) {
        console.log(`[${this.config.id}] Stream copy failed on exit, trying reencoding...`);
        hasErrored = true;
        this.startFFmpegWithReencoding();
      }
    }

    this.ffmpeg.addListener('exit', handleFfmpegExit);
    setTimeout(() => { this.ffmpeg?.removeListener('exit', handleFfmpegExit); }, 5000);
  }

  // Fallback method with reencoding for problematic streams
  private startFFmpegWithReencoding() {
    console.log(`[${this.config.id}] Starting FFmpeg with reencoding for compatibility...`);

    const inputUrl = this.config.ffmpegInput.startsWith('rtsp://')
      ? this.getRtspUrlWithAuth()
      : this.config.ffmpegInput;

    const inputArgs = this.config.ffmpegInput.startsWith('rtsp://')
      ? ['-rtsp_transport', 'udp', '-i', inputUrl]
      : ['-f', 'dshow', '-use_wallclock_as_timestamps', '1', '-i', inputUrl];

    const ffmpegArgs = [
      ...inputArgs,
      '-fflags', '+genpts+igndts+nobuffer',
      '-rtbufsize', '1500M',
      // Force re-encoding with iOS-compatible settings
      '-c:v', 'libx264',
      '-profile:v', 'baseline',
      '-level', '3.0',
      '-pix_fmt', 'yuv420p',
      '-preset', 'ultrafast',
      '-tune', 'zerolatency',
      // Handle audio mapping for reencoding too
      '-map', '0:v:0',
      '-map', '0:a:0?', // Optional audio mapping
      '-c:a', 'aac',
      '-ar', '44100',
      '-ac', '2',
      '-b:a', '128k',
      // Allow variable frame rate even when reencoding
      '-vsync', '0',
      '-async', '1',
      '-f', 'hls',
      '-hls_time', '2',
      '-hls_list_size', '3',
      '-hls_flags', 'program_date_time+independent_segments',
      '-hls_segment_filename', path.join(this.config.hlsDir, 'segment_%03d.ts'),
      path.join(this.config.hlsDir, 'stream.m3u8')
    ];

    this.ffmpeg = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'ignore', 'pipe'],
      windowsHide: true,
      shell: false
    });

    this.ffmpeg.stderr?.on('data', data => {
      const output = data.toString();
      // Filter out SEI warnings in reencoded stream too
      if (output.includes('SEI type') && output.includes('truncated')) {
        return;
      }
      // Filter out audio warnings
      if (output.includes('Stream map \'0:a:0\' matches no streams') ||
        output.includes('No audio streams found')) {
        console.log(`[${this.config.id}] No audio stream detected in reencoded stream, continuing with video only`);
        return;
      }
      // Uncomment for debugging reencoding
      // console.error(`[${this.config.id}] FFmpeg (reencoded): ${output}`);
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

  // Cleanup method to stop all streams
  destroy() {
    this.stopWebRTCStream();
    this.ffmpeg?.kill('SIGTERM');
    this.webrtcClients.clear();
  }
}
