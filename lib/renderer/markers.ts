/**
 * Where each step lands in the finished video, so an editor (or a chapter
 * list, or a caption file) can find a click without scrubbing.
 */

export interface StepMarker {
  index: number
  action: string
  label: string
  /** Seconds into the output video. */
  start: number
  end: number
  annotation?: string
}

const stamp = (seconds: number) => {
  const ms = Math.max(0, Math.round(seconds * 1000))
  const h = Math.floor(ms / 3_600_000)
  const m = Math.floor((ms % 3_600_000) / 60_000)
  const s = Math.floor((ms % 60_000) / 1000)
  const pad = (n: number, w = 2) => String(n).padStart(w, '0')
  return `${pad(h)}:${pad(m)}:${pad(s)}.${pad(ms % 1000, 3)}`
}

/** WebVTT captions from the steps' annotations (steps without one are skipped). */
export function toVtt(markers: StepMarker[]): string {
  const cues = markers
    .filter((m) => m.annotation && m.end > m.start)
    .map((m) => `${stamp(m.start)} --> ${stamp(m.end)}\n${m.annotation}`)
  return `WEBVTT\n\n${cues.join('\n\n')}${cues.length ? '\n' : ''}`
}

/** "{minutes} min later" style text for a skipped wait. */
export function skipCardText(waitedSeconds: number, template: string | true): string {
  const minutes = Math.max(1, Math.round(waitedSeconds / 60))
  if (template === true) {
    return waitedSeconds < 90 ? `${Math.max(1, Math.round(waitedSeconds))} s later` : `${minutes} min later`
  }
  return template
    .replace(/\{minutes\}/g, String(minutes))
    .replace(/\{seconds\}/g, String(Math.round(waitedSeconds)))
}
