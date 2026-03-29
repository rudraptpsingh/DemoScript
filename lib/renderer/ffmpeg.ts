import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from '@ffmpeg-installer/ffmpeg'
import path from 'path'
import fs from 'fs'
import { FORMAT_SPECS, FormatId } from './formats'

ffmpeg.setFfmpegPath(ffmpegPath.path)

export interface EncodeOptions {
  frameDir: string
  outputPath: string
  fps: number
  width: number
  height: number
}

export async function encodeFramesToVideo(options: EncodeOptions): Promise<void> {
  const { frameDir, outputPath, fps, width, height } = options

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(path.join(frameDir, 'frame_%04d.png'))
      .inputFPS(fps)
      .videoCodec('libx264')
      .outputOptions([
        '-pix_fmt yuv420p',
        '-preset slow',
        '-crf 18',
        `-vf scale=${width}:${height}:flags=lanczos`,
        '-movflags +faststart',
      ])
      .output(outputPath)
      .on('start', (cmd) => console.log('FFmpeg started:', cmd))
      .on('progress', (p) =>
        console.log(`Encoding: ${Math.round(p.percent || 0)}%`)
      )
      .on('end', () => {
        console.log('Encoding complete')
        resolve()
      })
      .on('error', (err) => {
        console.error('FFmpeg error:', err)
        reject(err)
      })
      .run()
  })
}

export async function encodeFramesToGif(options: EncodeOptions): Promise<void> {
  const { frameDir, outputPath, fps, width } = options
  const paletteFile = outputPath.replace('.gif', '_palette.png')

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(path.join(frameDir, 'frame_%04d.png'))
      .inputFPS(fps)
      .videoFilters(
        `scale=${width}:-1:flags=lanczos,palettegen=stats_mode=diff`
      )
      .output(paletteFile)
      .on('end', () => resolve())
      .on('error', reject)
      .run()
  })

  await new Promise<void>((resolve, reject) => {
    ffmpeg()
      .input(path.join(frameDir, 'frame_%04d.png'))
      .inputFPS(fps)
      .input(paletteFile)
      .complexFilter(
        `scale=${width}:-1:flags=lanczos[x];[x][1:v]paletteuse=dither=bayer`
      )
      .output(outputPath)
      .on('end', () => {
        if (fs.existsSync(paletteFile)) fs.unlinkSync(paletteFile)
        resolve()
      })
      .on('error', reject)
      .run()
  })
}

export interface MultiFormatEncodeOptions {
  frameDir: string
  baseOutputPath: string
  fps: number
  viewport: { width: number; height: number }
  formatIds: FormatId[]
}

export interface FormatEncodeResult {
  success: boolean
  outputPath?: string
  fileSizeBytes?: number
  error?: string
}

export type MultiFormatResult = Record<string, FormatEncodeResult>

export async function encodeMultipleFormats(
  options: MultiFormatEncodeOptions
): Promise<MultiFormatResult> {
  const { frameDir, baseOutputPath, fps, viewport, formatIds } = options

  if (formatIds.length === 0) {
    return {}
  }

  const tasks = formatIds.map(async (formatId): Promise<[string, FormatEncodeResult]> => {
    const spec = FORMAT_SPECS[formatId]
    if (!spec) {
      return [formatId, { success: false, error: `Unknown format: ${formatId}` }]
    }

    const outputPath = `${baseOutputPath}_${formatId}.${spec.extension}`

    try {
      if (formatId === 'gif') {
        const gifFps = spec.fps ?? 15
        const gifWidth = spec.targetWidth ?? viewport.width
        await encodeFramesToGif({
          frameDir,
          outputPath,
          fps: gifFps,
          width: gifWidth,
          height: viewport.height,
        })
      } else if (spec.isThumbnail) {
        await encodeThumbnail({ frameDir, outputPath })
      } else if (formatId === 'mp4-linkedin') {
        await encodeLinkedInSquare({ frameDir, outputPath, fps, viewport })
      } else {
        // Standard and Twitter MP4
        const extraOpts: string[] = []
        if (spec.maxDurationSeconds) {
          extraOpts.push(`-t ${spec.maxDurationSeconds}`)
        }
        await encodeStandardMp4({ frameDir, outputPath, fps, viewport, extraOptions: extraOpts })
      }

      const stat = fs.statSync(outputPath)
      const fileSizeBytes = stat.size

      if (formatId === 'gif' && fileSizeBytes > 5 * 1024 * 1024) {
        console.warn(
          `Warning: GIF output is ${(fileSizeBytes / 1024 / 1024).toFixed(1)}MB, exceeds 5MB`
        )
      }

      return [formatId, { success: true, outputPath, fileSizeBytes }]
    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : String(err)
      console.error(`Failed to encode format ${formatId}: ${errorMsg}`)
      return [formatId, { success: false, error: errorMsg }]
    }
  })

  const settled = await Promise.allSettled(tasks)
  const result: MultiFormatResult = {}

  for (const item of settled) {
    if (item.status === 'fulfilled') {
      const [id, encResult] = item.value
      result[id] = encResult
    }
  }

  return result
}

async function encodeStandardMp4(options: {
  frameDir: string
  outputPath: string
  fps: number
  viewport: { width: number; height: number }
  extraOptions?: string[]
}): Promise<void> {
  const { frameDir, outputPath, fps, viewport, extraOptions = [] } = options

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(path.join(frameDir, 'frame_%04d.png'))
      .inputFPS(fps)
      .videoCodec('libx264')
      .outputOptions([
        '-pix_fmt yuv420p',
        '-preset slow',
        '-crf 18',
        `-vf scale=${viewport.width}:${viewport.height}:flags=lanczos`,
        '-movflags +faststart',
        ...extraOptions,
      ])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run()
  })
}

async function encodeLinkedInSquare(options: {
  frameDir: string
  outputPath: string
  fps: number
  viewport: { width: number; height: number }
}): Promise<void> {
  const { frameDir, outputPath, fps, viewport } = options
  const squareSize = Math.min(viewport.width, viewport.height)
  const cropX = Math.floor((viewport.width - squareSize) / 2)
  const cropY = Math.floor((viewport.height - squareSize) / 2)
  const cropFilter = `crop=${squareSize}:${squareSize}:${cropX}:${cropY},scale=1080:1080:flags=lanczos`

  return new Promise((resolve, reject) => {
    ffmpeg()
      .input(path.join(frameDir, 'frame_%04d.png'))
      .inputFPS(fps)
      .videoCodec('libx264')
      .outputOptions([
        '-pix_fmt yuv420p',
        '-preset slow',
        '-crf 18',
        `-vf ${cropFilter}`,
        '-movflags +faststart',
      ])
      .output(outputPath)
      .on('end', () => resolve())
      .on('error', reject)
      .run()
  })
}

async function encodeThumbnail(options: {
  frameDir: string
  outputPath: string
}): Promise<void> {
  const { frameDir, outputPath } = options
  const firstFrame = path.join(frameDir, 'frame_0001.png')

  if (!fs.existsSync(firstFrame)) {
    throw new Error(`First frame not found: ${firstFrame}`)
  }

  fs.copyFileSync(firstFrame, outputPath)
}
