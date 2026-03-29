export type FormatId =
  | 'mp4-standard'
  | 'mp4-twitter'
  | 'mp4-linkedin'
  | 'gif'
  | 'thumbnail'

export interface FormatSpec {
  id: FormatId
  label: string
  extension: string
  description: string
  maxDurationSeconds?: number
  aspectRatio?: string
  ffmpegOptions: string[]
  targetWidth: number | null
  targetHeight: number | null
  fps?: number
  isThumbnail?: boolean
}

export const FORMAT_SPECS: Record<FormatId, FormatSpec> = {
  'mp4-standard': {
    id: 'mp4-standard',
    label: 'Standard MP4',
    extension: 'mp4',
    description: 'Full-resolution MP4 for general use and web playback',
    ffmpegOptions: [
      '-vcodec libx264',
      '-pix_fmt yuv420p',
      '-preset slow',
      '-crf 18',
      '-movflags +faststart',
    ],
    targetWidth: null,
    targetHeight: null,
  },
  'mp4-twitter': {
    id: 'mp4-twitter',
    label: 'Twitter/X MP4',
    extension: 'mp4',
    description: 'Twitter-optimized MP4 (max 60 seconds, H.264)',
    maxDurationSeconds: 60,
    ffmpegOptions: [
      '-vcodec libx264',
      '-pix_fmt yuv420p',
      '-preset slow',
      '-crf 18',
      '-movflags +faststart',
      '-t 60',
    ],
    targetWidth: null,
    targetHeight: null,
  },
  'mp4-linkedin': {
    id: 'mp4-linkedin',
    label: 'LinkedIn MP4',
    extension: 'mp4',
    description: 'Square 1:1 crop for LinkedIn, scaled to 1080x1080',
    aspectRatio: '1:1',
    ffmpegOptions: [
      '-vcodec libx264',
      '-pix_fmt yuv420p',
      '-preset slow',
      '-crf 18',
      '-movflags +faststart',
    ],
    targetWidth: 1080,
    targetHeight: 1080,
  },
  'gif': {
    id: 'gif',
    label: 'GIF',
    extension: 'gif',
    description: 'Optimized GIF with palette generation, 600px wide at 15fps',
    ffmpegOptions: [],
    targetWidth: 600,
    targetHeight: null,
    fps: 15,
  },
  'thumbnail': {
    id: 'thumbnail',
    label: 'Thumbnail PNG',
    extension: 'png',
    description: 'First frame at full resolution for social sharing',
    ffmpegOptions: ['-frames:v 1', '-ss 0'],
    targetWidth: null,
    targetHeight: null,
    isThumbnail: true,
  },
}

export const ALL_FORMAT_IDS: FormatId[] = [
  'mp4-standard',
  'mp4-twitter',
  'mp4-linkedin',
  'gif',
  'thumbnail',
]
