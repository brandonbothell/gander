export type Recording = {
  streamId: string
  filename: string
  nickname: string
  duration: number
  motionTimestamps: number[]
}

export interface Stream {
  id: string
  nickname: string
  ffmpegInput: string
  rtspUser?: string
  rtspPass?: string
  createdAt: string
  updatedAt?: string
}
