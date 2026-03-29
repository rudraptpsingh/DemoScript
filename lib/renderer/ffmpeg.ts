import ffmpeg from 'fluent-ffmpeg'
import ffmpegPath from '@ffmpeg-installer/ffmpeg'
import path from 'path'
import fs from 'fs'

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
        fs.unlinkSync(paletteFile)
        resolve()
      })
      .on('error', reject)
      .run()
  })
}
