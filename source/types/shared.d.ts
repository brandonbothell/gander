export interface StreamMask {
    id: string;
    streamId: string;
    mask: string;
    type?: string | null;
    createdAt: string;
    updatedAt?: string;
}
export interface Stream {
    id: string;
    nickname: string;
    ffmpegInput: string;
    rtspUser?: string;
    rtspPass?: string;
    createdAt: string;
    updatedAt?: string;
}
