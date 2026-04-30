import { ChildProcess } from 'child_process'

// --- Per-stream motion state ---
export interface StreamMotionState {
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
  startedRecordingAt: number
  lastSegmentProcessAt?: number
  flushTimer?: NodeJS.Timeout // Timer for flushing segments
  flushedSegments: string[] // Segments that have been flushed
  flushRecordings: string[] // Filenames of that have been flushed
  nextFlushNumber: number // Next flush number to use for segment naming
  recordingTitle: string // Title for the current recording
  cleaningUp: boolean // Whether HLS/flush directory cleanup is in progress
  cancelFlush: boolean // Whether to cancel the current flush operation
  lowSpaceNotified: boolean // new flag to avoid spamming notifications
}

export type SignedUrl = {
  filename: string
  url: string
  expiresAt: number
}
