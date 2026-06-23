import { ChildProcess } from 'child_process'

// --- Per-stream motion state ---
export interface StreamMotionState {
  segmentTimestampMap: Map<string, number>
  processingSegment: boolean
  notificationSent: boolean
  motionRecordingActive: boolean
  motionTimeout?: NodeJS.Timeout
  motionRecordingTimeoutAt: number
  motionSegments: string[]
  flushingSegments: string[] // Segments currently being flushed
  recentSegments: string[]
  motionPaused: boolean
  startupTime: number
  savingInProgress: boolean
  currentSaveProcess: ChildProcess | null
  saveRetryCount: number
  motionStartedAt: number
  lastSegmentProcessAt?: number
  flushTimer?: NodeJS.Timeout // Timer for flushing segments
  flushedSegments: string[] // Segments that have been flushed
  flushRecordings: string[] // Filenames of that have been flushed
  nextFlushNumber: number // Next flush number to use for segment naming
  recordingTitle: string // Title for the current recording
  cleaningUp: boolean // Whether HLS/flush directory cleanup is in progress
  cancelFlush: boolean // Whether to cancel the current flush operation
  lowSpaceNotified: boolean // Flag to avoid spamming notifications
  lastNotifiedRestartCooldownAt: number // Same as above
  /**
   * Array of times in milliseconds since start the of a recording that motion was detected, excluding the first.
   */
  currentRecordingMotionTimestamps: number[]
  lastPlaylistUpdatedAt: number // Timestamp of the last stream.m3u8 file update, used to detect if the stream is still active
}

export type SignedUrl = {
  filename: string
  url: string
  expiresAt: number
}
