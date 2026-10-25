import fs from 'fs'
import path from 'path'
import type { CDPSession, Page } from 'playwright'

/**
 * Live capture: record a page in real time from the Chrome screencast instead
 * of taking one screenshot per frame.
 *
 * The frame-by-frame engine is deterministic and right for a page that only
 * moves when DemoScript moves it. An app doing real work — a backup counting
 * up, an export, a sync — moves on its own clock, and a screenshot per frame
 * (~100 ms each at 2x) cannot keep up. The screencast sends a frame whenever
 * the page changes, stamped with when; recording can be paused, so an hour of
 * waiting becomes nothing in the video. At the end the frames are resampled to
 * a constant rate and written as frame_0001.jpg… for the usual encoders.
 */

export interface LiveFrame {
  file: string
  /** Seconds (screencast clock). */
  ts: number
}

export interface Segment {
  start: number
  end: number
}

/**
 * The frame to show at each output tick: the latest frame at or before that
 * moment, inside recorded segments only. A segment that starts before its
 * first frame arrives shows the last frame seen before it (the page has not
 * changed since then), or the first frame after it when there is none.
 */
export function resampleFrames(frames: LiveFrame[], segments: Segment[], fps: number): string[] {
  const sorted = [...frames].sort((a, b) => a.ts - b.ts)
  if (sorted.length === 0) return []
  const out: string[] = []
  let i = 0
  for (const seg of segments) {
    const ticks = Math.round((seg.end - seg.start) * fps)
    for (let n = 0; n < ticks; n++) {
      const t = seg.start + n / fps
      while (i + 1 < sorted.length && sorted[i + 1].ts <= t) i++
      out.push(sorted[i].ts <= t ? sorted[i].file : sorted[0].file)
    }
  }
  return out
}

/** Recorded seconds so far: the output timeline in live mode. */
export function recordedSeconds(segments: Segment[], now?: number): number {
  return segments.reduce((sum, s) => sum + ((s.end ?? now ?? s.start) - s.start), 0)
}

export class LiveRecorder {
  readonly frames: LiveFrame[] = []
  readonly segments: Segment[] = []
  private open: { start: number } | null = null
  private cdp: CDPSession | null = null
  private seq = 0
  /** Screencast and wall clock differ by an offset; track it from frames. */
  private clockOffset = 0

  constructor(
    private readonly page: Page,
    private readonly dir: string,
    private readonly size: { width: number; height: number }
  ) {}

  async start(): Promise<void> {
    fs.mkdirSync(this.dir, { recursive: true })
    this.cdp = await this.page.context().newCDPSession(this.page)
    this.cdp.on('Page.screencastFrame', (frame) => {
      void this.cdp?.send('Page.screencastFrameAck', { sessionId: frame.sessionId }).catch(() => {})
      const ts = frame.metadata.timestamp ?? Date.now() / 1000
      this.clockOffset = Date.now() / 1000 - ts
      const file = path.join(this.dir, `live_${String(this.seq++).padStart(6, '0')}.jpg`)
      fs.writeFileSync(file, frame.data, 'base64')
      this.frames.push({ file, ts })
    })
    // Keep frames flowing for the whole run: a page that is not recording
    // still has to report its latest look, or a resumed segment would open on
    // a stale frame.
    await this.cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 90,
      maxWidth: this.size.width * 2,
      maxHeight: this.size.height * 2,
    })
    this.resume()
  }

  /** Screencast-clock seconds now. */
  private now(): number {
    return Date.now() / 1000 - this.clockOffset
  }

  get recording(): boolean {
    return this.open !== null
  }

  pause(): void {
    if (!this.open) return
    this.segments.push({ start: this.open.start, end: this.now() })
    this.open = null
  }

  resume(): void {
    if (!this.open) this.open = { start: this.now() }
  }

  /** Seconds in the output so far. */
  elapsed(): number {
    return recordedSeconds(this.segments) + (this.open ? this.now() - this.open.start : 0)
  }

  async stop(): Promise<void> {
    this.pause()
    await this.cdp?.send('Page.stopScreencast').catch(() => {})
    await this.cdp?.detach().catch(() => {})
    this.cdp = null
  }

  /** Write frame_0001.jpg… (hard links) for the encoders; returns the count. */
  writeConstantRate(frameDir: string, fps: number): number {
    const picks = resampleFrames(this.frames, this.segments, fps)
    picks.forEach((file, n) => {
      const target = path.join(frameDir, `frame_${String(n + 1).padStart(4, '0')}.jpg`)
      try {
        fs.linkSync(file, target)
      } catch {
        fs.copyFileSync(file, target)
      }
    })
    return picks.length
  }
}
