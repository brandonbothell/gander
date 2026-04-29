// Match your Prisma model for StreamMask
export interface StreamMask {
  id: string
  streamId: string
  mask: string // JSON string, e.g. '{"x":10,"y":20,"w":100,"h":50}'
  type?: string | null
  createdAt: string // or Date, depending on your API serialization
  updatedAt?: string // if you have this field
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
