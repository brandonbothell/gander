import path from 'path'
import fs from 'fs'
import { exec, spawn } from 'child_process'
import {
  saveMotionSegments,
  setupStreamMotionMonitoring,
  stopStreamMotionMonitoring,
  StreamMotionState,
} from './camera'
import { logMotion } from './logMotion'

export interface StreamConfig {
  id: string
  hlsDir: string
  recordDir: string
  thumbDir: string
  flushDir: string
  ffmpegInput: string
  rtspUser?: string
  rtspPass?: string
}

export class StreamManager {
  config: StreamConfig
  private webrtcClients: Set<string> = new Set()
  private webrtcProcess: ReturnType<typeof spawn> | null = null
  private ffmpeg: ReturnType<typeof spawn> | null = null
  private segmentMonitorTimer: NodeJS.Timeout | null = null
  private lastSegmentTimestamp: number = Date.now()
  private segmentCount: number = 0
  private recentSegmentGaps: number[] = []
  private restartInProgress = false
  private state: StreamMotionState
  private lastRestartTimestamp = 0
  private ffmpegCooldownUntil: number = 0
  private ffmpegRestartTimestamps: number[] = []
  private static readonly MAX_RESTARTS = 5
  private static readonly RESTART_WINDOW_MS = 60 * 1000
  private static readonly COOLDOWN_MS = 5 * 60 * 1000

  constructor(config: StreamConfig, state: StreamMotionState) {
    this.config = config
    this.state = state
    this.deleteHlsDir()
    ;[
      config.hlsDir,
      config.recordDir,
      config.thumbDir,
      config.flushDir,
    ].forEach((dir) => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    })
  }

  private getRtspUrlWithAuth(): string {
    if (
      this.config.ffmpegInput.startsWith('rtsp://') &&
      this.config.rtspUser &&
      this.config.rtspPass
    ) {
      let url = this.config.ffmpegInput

      // Use stream1 (main stream) but with reencoding for stability
      if (url.endsWith(':554') || url.endsWith(':554/')) {
        url = url.replace(/\/?$/, '/stream1') // Main stream for better quality
      }

      return url.replace(
        /^rtsp:\/\//,
        `rtsp://${encodeURIComponent(this.config.rtspUser)}:${encodeURIComponent(this.config.rtspPass)}@`,
      )
    }
    return this.config.ffmpegInput
  }

  // Add client to WebRTC stream
  addWebRTCClient(clientId: string): boolean {
    if (this.webrtcClients.size === 0) {
      this.startWebRTCStream()
    }
    this.webrtcClients.add(clientId)
    console.info(
      `[${this.config.id}] WebRTC client ${clientId} added. Total clients: ${this.webrtcClients.size}`,
    )
    return true
  }

  // Remove client from WebRTC stream
  removeWebRTCClient(clientId: string): void {
    this.webrtcClients.delete(clientId)
    console.info(
      `[${this.config.id}] WebRTC client ${clientId} removed. Total clients: ${this.webrtcClients.size}`,
    )

    if (this.webrtcClients.size === 0) {
      this.stopWebRTCStream()
    }
  }

  // Start WebRTC stream optimized for Pi 4
  private startWebRTCStream(): void {
    if (this.webrtcProcess) {
      console.info(`[${this.config.id}] WebRTC stream already running`)
      return
    }

    const inputIsRtsp = this.config.ffmpegInput.startsWith('rtsp://')
    const inputUrl = inputIsRtsp
      ? this.getRtspUrlWithAuth()
      : this.config.ffmpegInput

    const webrtcArgs = [
      '-y',
      '-fflags',
      '+genpts',
      '-analyzeduration',
      '1000000',
      '-probesize',
      '1000000',
      ...(inputIsRtsp
        ? ['-rtsp_transport', 'udp', '-i', inputUrl]
        : [
            '-f',
            'v4l2',
            '-input_format',
            'mjpeg',
            '-video_size',
            '640x360',
            '-framerate',
            '10',
            '-i',
            inputUrl,
          ]),

      // Balanced encoding for WebRTC
      '-c:v',
      'libx264',
      '-preset',
      'faster', // Less aggressive than ultrafast
      '-tune',
      'zerolatency',
      '-profile:v',
      'baseline',
      '-level',
      '3.0',
      '-pix_fmt',
      'yuv420p',
      '-b:v',
      '400k',
      '-maxrate',
      '500k',
      '-bufsize',
      '1000k',
      '-g',
      '25',
      '-keyint_min',
      '25',
      '-x264opts',
      'keyint=25:min-keyint=25:no-scenecut:threads=3', // More threads
      '-vf',
      'scale=640:360',

      // Audio
      '-c:a',
      'libopus',
      '-ar',
      '24000',
      '-ac',
      '1',
      '-b:a',
      '48k',

      // WebM output
      '-f',
      'webm',
      '-deadline',
      'realtime',
      '-cpu-used',
      '6', // Less aggressive than 8
      '-',
    ]

    console.info(`[${this.config.id}] Starting WebRTC stream...`)
    this.webrtcProcess = spawn('ffmpeg', webrtcArgs, {
      stdio: ['ignore', 'pipe', 'pipe'],
      shell: false,
    })

    this.webrtcProcess.stderr?.on('data', (data) => {
      const output = data.toString()
      if (output.includes('Error') || output.includes('Invalid')) {
        console.error(`[${this.config.id}] WebRTC FFmpeg Error: ${output}`)
      }
    })

    this.webrtcProcess.on('exit', (code, signal) => {
      console.info(
        `[${this.config.id}] WebRTC FFmpeg exited with code ${code} and signal ${signal}`,
      )
      this.webrtcProcess = null

      if (this.webrtcClients.size > 0 && code !== 0 && signal !== 'SIGTERM') {
        console.info(`[${this.config.id}] Restarting WebRTC stream...`)
        setTimeout(() => this.startWebRTCStream(), 2000)
      }
    })
  }

  private stopWebRTCStream(): void {
    if (this.webrtcProcess) {
      console.info(`[${this.config.id}] Stopping WebRTC stream...`)
      this.webrtcProcess.kill('SIGTERM')
      this.webrtcProcess = null
    }
  }

  getWebRTCStream() {
    return this.webrtcProcess?.stdout
  }

  isWebRTCActive(): boolean {
    return this.webrtcProcess !== null && this.webrtcClients.size > 0
  }

  getWebRTCClientCount(): number {
    return this.webrtcClients.size
  }

  getFFmpegCooldownUntil(): number {
    return this.ffmpegCooldownUntil
  }

  // Main HLS stream - balanced for stability and performance
  async startFFmpeg() {
    // --- Cooldown and cleaning guards ---
    if (this.ffmpegCooldownUntil && Date.now() < this.ffmpegCooldownUntil) {
      logMotion(
        `[${this.config.id}] FFmpeg restart cooldown active. Next restart allowed at ${new Date(this.ffmpegCooldownUntil).toLocaleTimeString()}`,
        'warn',
      )
      return
    }
    if (this.state.cleaningUp) {
      logMotion(
        `[${this.config.id}] FFmpeg is cleaning up, waiting to start`,
        'warn',
      )
      setTimeout(
        () =>
          this.startFFmpeg().catch((err) => {
            console.warn(
              `[${this.config.id}] FFmpeg failed to start:`,
              err?.message || err,
            )
          }),
        5000,
      )
      return
    }
    const now = Date.now()
    this.segmentCount = 0
    this.lastSegmentTimestamp = now
    this.ffmpegRestartTimestamps = this.ffmpegRestartTimestamps.filter(
      (ts) => now - ts < StreamManager.RESTART_WINDOW_MS,
    )
    this.ffmpegRestartTimestamps.push(now)
    if (this.ffmpegRestartTimestamps.length > StreamManager.MAX_RESTARTS) {
      this.ffmpegCooldownUntil = now + StreamManager.COOLDOWN_MS
      logMotion(
        `[${this.config.id}] Too many FFmpeg restarts (${this.ffmpegRestartTimestamps.length} in ${StreamManager.RESTART_WINDOW_MS / 1000}s). Entering cooldown for ${StreamManager.COOLDOWN_MS / 60000} minutes.`,
        'error',
      )
      return
    }
    if (now - this.lastRestartTimestamp < 10000) {
      logMotion(
        `[${this.config.id}] Restart requested too soon after previous (${now - this.lastRestartTimestamp}ms), skipping.`,
        'warn',
      )
      return
    }
    this.lastRestartTimestamp = now

    const start = Date.now()
    this.state.cleaningUp = true
    try {
      await Promise.all([
        fastCleanDir(this.config.hlsDir),
        fastCleanDir(this.config.flushDir),
      ])
    } catch (e) {
      logMotion(
        `[${this.config.id}] Error cleaning HLS and flush directories: ${e}`,
        'error',
      )
    }
    this.state.cleaningUp = false

    const elapsed = Date.now() - start
    if (elapsed > 500) {
      console.warn(
        `[${this.config.id}] HLS & flush directory cleanup took ${elapsed}ms`,
      )
    }
    console.debug(
      `[${this.config.id}] Cleaned HLS & flush directories: ${this.config.hlsDir}, ${this.config.flushDir}`,
    )
    ;[
      this.config.hlsDir,
      this.config.recordDir,
      this.config.thumbDir,
      this.config.flushDir,
    ].forEach((dir) => {
      if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true })
    })

    // --- FFmpeg args and spawn ---
    const inputIsRtsp = this.config.ffmpegInput.startsWith('rtsp://')
    const inputUrl = inputIsRtsp
      ? this.getRtspUrlWithAuth()
      : this.config.ffmpegInput
    let ffmpegArgs: string[]
    if (inputIsRtsp) {
      ffmpegArgs = [
        '-y',
        '-fflags',
        '+genpts+discardcorrupt',
        '-rtsp_transport',
        'udp',
        '-analyzeduration',
        '2000000',
        '-probesize',
        '2000000',
        '-i',
        inputUrl,
        '-c:v',
        'copy',
        '-map',
        '0:v:0',
        '-map',
        '0:a:0?',
        '-c:a',
        'aac',
        '-ar',
        '44100',
        '-ac',
        '2',
        '-b:a',
        '128k',
        '-avoid_negative_ts',
        'make_zero',
        '-copyts',
        '-start_at_zero',
        '-muxdelay',
        '0',
        '-f',
        'hls',
        '-hls_time',
        '0.5',
        '-hls_list_size',
        '6',
        '-hls_flags',
        'independent_segments',
        '-hls_segment_filename',
        path.join(this.config.hlsDir, 'segment_%03d.ts'),
        path.join(this.config.hlsDir, 'stream.m3u8'),
      ]
    } else {
      ffmpegArgs = [
        '-y',
        '-f',
        'v4l2',
        '-input_format',
        'mjpeg',
        '-video_size',
        '1280x720',
        '-framerate',
        '15',
        '-i',
        inputUrl,
        '-c:v',
        'libx264',
        '-preset',
        'faster',
        '-tune',
        'zerolatency',
        '-profile:v',
        'main',
        '-level',
        '3.1',
        '-pix_fmt',
        'yuv420p',
        '-b:v',
        '1000k',
        '-maxrate',
        '1200k',
        '-bufsize',
        '2400k',
        '-g',
        '30',
        '-x264opts',
        'keyint=30:min-keyint=30:no-scenecut:threads=3',
        '-an',
        '-f',
        'hls',
        '-hls_time',
        '0.5',
        '-hls_list_size',
        '6',
        '-hls_flags',
        'independent_segments',
        '-hls_segment_filename',
        path.join(this.config.hlsDir, 'segment_%03d.ts'),
        path.join(this.config.hlsDir, 'stream.m3u8'),
      ]
    }
    console.info(
      `[${this.config.id}] Starting FFmpeg with args:`,
      ffmpegArgs.join(' '),
    )
    const ffmpegProcess = spawn('ffmpeg', ffmpegArgs, {
      stdio: ['ignore', 'ignore', 'pipe'],
      shell: false,
    })
    this.ffmpeg = ffmpegProcess
    let hasErrored = false

    // --- Wait for first segment creation ---
    let firstSegmentCreated = false
    let firstSegmentPromiseResolve: (() => void) | null = null
    const firstSegmentPromise = new Promise<void>((resolve) => {
      firstSegmentPromiseResolve = resolve
    })

    // --- Robust segment monitor ---
    if (this.segmentMonitorTimer) clearInterval(this.segmentMonitorTimer)
    this.segmentMonitorTimer = setInterval(() => {
      const now = Date.now()
      if (this.restartInProgress || this.state.cleaningUp) return
      if (this.segmentCount > 0 && now - this.lastSegmentTimestamp > 15000) {
        logMotion(
          `[${this.config.id}] No HLS segments created for ${Math.floor((now - this.lastSegmentTimestamp) / 1000)}s (total segments: ${this.segmentCount}), restarting FFmpeg (auto health check)`,
          'warn',
        )
        this.reconnect()
      } else if (
        this.segmentCount === 0 &&
        now - this.lastSegmentTimestamp > 30000
      ) {
        logMotion(
          `[${this.config.id}] No HLS segments created for ${Math.floor((now - this.lastSegmentTimestamp) / 1000)}s (total segments: 0), restarting FFmpeg (auto health check)`,
          'warn',
        )
        this.reconnect()
      }
    }, 5000)

    ffmpegProcess.on('exit', (code, signal) => {
      if (this.ffmpeg?.pid !== ffmpegProcess.pid) return
      this.ffmpeg = null
      logMotion(
        `[${this.config.id}] FFmpeg exited with code ${code} and signal ${signal} (${this.segmentCount} segments created)`,
        'warn',
      )
      if (this.segmentMonitorTimer) {
        clearInterval(this.segmentMonitorTimer)
        this.segmentMonitorTimer = null
      }
      // Reject the promise if FFmpeg exits before first segment
      if (!firstSegmentCreated && firstSegmentPromiseResolve) {
        console.error('FFmpeg exited before first segment was created')
        firstSegmentPromiseResolve()
      }
      if (this.ffmpegCooldownUntil && Date.now() < this.ffmpegCooldownUntil) {
        logMotion(
          `[${this.config.id}] FFmpeg restart cooldown active. Skipping restart.`,
          'warn',
        )
        return
      }
      if (
        ((code === 0 && signal === null) || code !== 0) &&
        code !== 255 &&
        signal !== 'SIGTERM' &&
        signal !== 'SIGKILL' &&
        signal !== 'SIGINT'
      ) {
        logMotion(
          `[${this.config.id}] FFmpeg crashed or exited unexpectedly (code ${code}, signal ${signal}), restarting...`,
          'warn',
        )
        this.reconnect()
      }
    })

    ffmpegProcess.stderr?.on('data', (data) => {
      const output = data.toString()
      // --- Segment creation tracking ---
      if (output.includes('Opening') && output.includes('segment_')) {
        const match = output.match(/segment_(\d+)\.ts/)
        const segNum = match ? match[1] : '?'
        logMotion(
          `[${this.config.id}] [SEGMENT] Created segment ${segNum} at ${new Date().toISOString()}`,
        )

        this.segmentCount++
        const now = Date.now()
        const timeSinceLastSegment = now - this.lastSegmentTimestamp
        this.lastSegmentTimestamp = now
        if (!firstSegmentCreated && firstSegmentPromiseResolve) {
          firstSegmentCreated = true
          firstSegmentPromiseResolve()
        }
        if (this.segmentCount > 1 && timeSinceLastSegment > 10000) {
          logMotion(
            `[${this.config.id}] Segment gap: ${timeSinceLastSegment}ms, total segments: ${this.segmentCount} (restarting FFmpeg)`,
            'warn',
          )
          if (
            this.ffmpegCooldownUntil &&
            Date.now() < this.ffmpegCooldownUntil
          ) {
            logMotion(
              `[${this.config.id}] FFmpeg restart cooldown active. Skipping restart.`,
              'warn',
            )
            return
          }
          this.reconnect()
        } else if (this.segmentCount > 1 && timeSinceLastSegment > 3000) {
          logMotion(
            `[${this.config.id}] Segment gap: ${timeSinceLastSegment}ms (possible stutter)`,
          )

          this.recentSegmentGaps.push(now)
          const stillRecentGapIndex = this.recentSegmentGaps.findIndex(
            (t) => t > now - 30000,
          ) // 30 seconds
          this.recentSegmentGaps =
            this.recentSegmentGaps.slice(stillRecentGapIndex)
          if (this.recentSegmentGaps.length >= 5) {
            logMotion(
              `[${this.config.id}] 5 or more segment gaps in 30 seconds, reconnecting...`,
            )
            this.reconnect()
          }
        }
      }
      // --- Error handling ---
      if (inputIsRtsp && !hasErrored && this.segmentCount < 3) {
        const hasRealError =
          output.includes('Connection refused') ||
          output.includes('Connection timed out') ||
          output.includes('No route to host') ||
          output.includes('401 Unauthorized') ||
          output.includes('403 Forbidden') ||
          output.includes('404 Not Found') ||
          output.includes('Invalid data found when processing input') ||
          output.includes('codec not currently supported in container') ||
          (output.includes('Packet corrupt') && !output.includes('DTS'))
        if (hasRealError) {
          console.warn(
            `[${this.config.id}] Stream copy failed, reconnecting...`,
          )
          hasErrored = true
          this.reconnect()
          return
        }
      }
      if (output.includes('Error') && !output.includes('Non-monotonous DTS')) {
        console.error(`[${this.config.id}] FFmpeg: ${output.trim()}`)
      }
    })

    // --- Wait for first segment or error ---
    // Add a timeout so this promise never hangs forever
    const timeoutMs = 15000 // 15 seconds
    const timeout = setTimeout(() => {
      if (!firstSegmentCreated && firstSegmentPromiseResolve) {
        console.error('FFmpeg did not create a segment in time')
        firstSegmentPromiseResolve()
      }
    }, timeoutMs)

    firstSegmentPromise.finally(() => clearTimeout(timeout))
    return firstSegmentPromise
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
    const streamId = this.config.id
    if (this.restartInProgress) {
      logMotion(
        `[${streamId}] Reconnect already in progress, skipping...`,
        'warn',
      )
      return
    }
    this.restartInProgress = true
    if (this.segmentMonitorTimer) {
      clearInterval(this.segmentMonitorTimer)
      this.segmentMonitorTimer = null
    }

    if (this.state?.motionTimeout) clearTimeout(this.state.motionTimeout)

    // Cancel any ongoing save operations
    if (this.state?.savingInProgress && this.state.currentSaveProcess) {
      console.log(`[${streamId}] [reconnect] Canceling ongoing save operation`)
      this.state.currentSaveProcess.kill('SIGTERM')
    }

    // Save any pending segments BEFORE stopping FFmpeg and cleaning directories
    if (
      this.state?.motionSegments.length > 0 ||
      this.state.flushRecordings.length > 0
    ) {
      logMotion(
        `[${streamId}] [reconnect] Saving ${this.state.motionSegments.length || this.state.flushRecordings.length} pending segments/flush recordings`,
      )
      try {
        await saveMotionSegments(streamId)
      } catch (error) {
        console.error(
          `[${streamId}] [reconnect] Failed to save pending segments:`,
          error,
        )
        logMotion(
          `[${streamId}] [reconnect] Failed to save pending segments: ${JSON.stringify(error, null, 2)}`,
          'error',
        )
      }
    }

    try {
      stopStreamMotionMonitoring(streamId)
      logMotion(`[${streamId}] Stopped stream motion monitoring`)
    } catch (e) {
      logMotion(
        `[${streamId}] Error stopping stream motion monitoring: ${e}`,
        'warn',
      )
    }
    // Kill managed ffmpeg process
    this.ffmpeg?.kill('SIGKILL')
    this.ffmpeg = null
    // Kill any stray ffmpeg processes (platform-specific)
    const killFFmpegPromise = new Promise<void>((resolve) => {
      // Also kill the managed ffmpeg process if still running
      this.ffmpeg?.kill('SIGKILL')
      this.ffmpeg = null

      try {
        const hlsDir = this.config.hlsDir
        if (process.platform === 'win32') {
          // Windows: use WMIC
          const searchStr = hlsDir.replace(/\\/g, '\\\\')
          exec(
            `wmic process where "CommandLine like '%${searchStr}%'" get ProcessId,CommandLine /FORMAT:CSV`,
            (err, stdout) => {
              if (!err && stdout) {
                const lines = stdout
                  .split('\n')
                  .filter((l) => l.toLowerCase().includes('ffmpeg'))
                for (const line of lines) {
                  const match = line.match(/,ffmpeg.*?(\d+)\s*$/i)
                  if (match) {
                    const pid = match[1]
                    logMotion(
                      `[${streamId}] Killing ffmpeg process with PID ${pid} (matched by HLS dir)`,
                    )
                    try {
                      process.kill(Number(pid), 'SIGKILL')
                    } catch {
                      logMotion(
                        `[${streamId}] Found no stray ffmpeg processes, continuing.`,
                      )
                    }
                  }
                }
              }
              resolve()
            },
          )
        } else {
          // Linux/macOS: use ps/grep/awk
          // Escape the hlsDir for grep (spaces, etc)
          const grepStr = hlsDir.replace(/(["'$`\\])/g, '\\$1')
          // Find all ffmpeg processes with the hlsDir in their command line
          exec(
            `ps -eo pid,command | grep '[f]fmpeg' | grep '${grepStr}' | awk '{print $1}'`,
            (err, stdout) => {
              if (!err && stdout) {
                const pids = stdout
                  .split('\n')
                  .map((line) => line.trim())
                  .filter(Boolean)
                for (const pid of pids) {
                  logMotion(
                    `[${streamId}] Killing ffmpeg process with PID ${pid} (matched by HLS dir)`,
                  )
                  try {
                    process.kill(Number(pid), 'SIGKILL')
                  } catch {
                    logMotion(
                      `[${streamId}] Found no stray ffmpeg processes, continuing.`,
                    )
                  }
                }
              }
              resolve()
            },
          )
        }
      } catch (e) {
        logMotion(`[${streamId}] Error killing ffmpeg processes: ${e}`, 'warn')
      }
    })

    await killFFmpegPromise

    // 2. Wait a bit for OS/camera to release resources
    await new Promise((res) => setTimeout(res, 1500)) // 1.5 seconds

    // 3. Restart FFmpeg
    try {
      await this.startFFmpeg().catch((err) => {
        console.warn(
          `[${this.config.id}] FFmpeg failed to start:`,
          err?.message || err,
        )
      })
      logMotion(`[${streamId}] FFmpeg restarted via reconnect`)
    } catch (e) {
      logMotion(`[${streamId}] Error restarting FFmpeg: ${e}`, 'error')
    }
    // 4. Restart motion monitoring for this stream
    try {
      await setupStreamMotionMonitoring(streamId)
      logMotion(`[${streamId}] Motion monitoring re-initialized`)
    } catch (e) {
      logMotion(
        `[${streamId}] Error re-initializing motion monitoring: ${e}`,
        'error',
      )
    }
    this.restartInProgress = false
    logMotion(`[${streamId}] Reconnect completed`)
  }

  getPlaylistPath() {
    return path.join(this.config.hlsDir, 'stream.m3u8')
  }

  getSegmentPath(segment: string) {
    return path.join(this.config.hlsDir, segment)
  }

  deleteHlsDir() {
    if (fs.existsSync(this.config.hlsDir)) {
      fs.rmSync(this.config.hlsDir, { recursive: true, force: true })
    }
  }

  destroy() {
    this.stopWebRTCStream()
    this.ffmpeg?.kill('SIGTERM')
    this.webrtcClients.clear()
    if (this.segmentMonitorTimer) {
      clearInterval(this.segmentMonitorTimer)
      this.segmentMonitorTimer = null
    }
  }
}

async function fastCleanDir(dir: string) {
  if (process.platform !== 'win32') {
    // Use rm -rf for speed on Linux
    await new Promise((resolve) => {
      exec(`rm -rf "${dir}"/*`, () => resolve(undefined))
    })
  } else {
    // Fallback to Node.js for Windows
    if (fs.existsSync(dir)) {
      const files = await fs.promises.readdir(dir)
      await Promise.all(
        files.map((f) =>
          fs.promises.rm(path.join(dir, f), { force: true, recursive: true }),
        ),
      )
    }
  }
}
