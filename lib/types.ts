export type ActionType =
  | 'scroll-to'
  | 'zoom-in'
  | 'zoom-out'
  | 'highlight'
  | 'pan'
  | 'cursor-move'
  | 'wait'
  | 'click'
  | 'type'
  | 'hover'
  | 'title'
  | 'wait-for'

export interface Step {
  id: string
  order: number
  target: string | null
  targetLabel: string
  action: ActionType
  duration: number
  zoom?: number
  easing?:
    | 'linear'
    | 'ease-in'
    | 'ease-out'
    | 'ease-in-out'
    | 'smooth'
    | 'ease-out-expo'
    | 'ease-in-out-quart'
    | 'spring'
  annotation?: string
  /** Where the caption sits. `callout` anchors it to `target`. */
  annotationPosition?: 'bottom' | 'top' | 'center' | 'callout'
  /** Quieter second line, under the caption or title-card heading. */
  subtitle?: string
  highlightColor?: string
  scrollOffset?: number
  /** Text to type character-by-character (for type action) */
  typeText?: string
  /**
   * wait-for: what to wait for. Nothing is recorded while waiting, so a step
   * that takes an hour in the app takes none in the video.
   */
  until?: { selector?: string; text?: string; js?: string }
  /** wait-for: give up after this many seconds (default 600). */
  timeout?: number
  /**
   * wait-for: after the wait, show a card for `duration` seconds saying how
   * long was skipped. true → "57 min later"; a string may use {minutes} and
   * {seconds}.
   */
  skipCard?: string | boolean
  /** false: run the step without recording it (live capture only). */
  record?: boolean
}

export interface DemoScript {
  id: string
  url: string
  /**
   * Attach to an ALREADY-RUNNING browser over the Chrome DevTools Protocol
   * instead of launching a fresh one, e.g. "http://127.0.0.1:9222".
   *
   * This is how you record something that is not a plain web page — an Electron
   * app, a desktop build, or a page that took a long sign-in to reach. The
   * caller owns that browser: DemoScript will not navigate it, will not resize
   * it, and will not close it when the render finishes. `url` and `viewport`
   * are ignored in this mode; the attached page is captured exactly as it is.
   */
  cdpUrl?: string
  /**
   * 'frames' (default): one screenshot per frame on a virtual clock —
   * deterministic, right for pages that move only when DemoScript moves them.
   * 'screencast': record in real time from the Chrome screencast — right for
   * an app doing real work on its own clock (progress, typing, live data).
   */
  capture?: 'frames' | 'screencast'
  viewport: { width: number; height: number }
  fps: number
  outputFormat: 'mp4' | 'gif' | 'webm'
  steps: Step[]
  createdAt: string
}

export type JobStatus =
  | 'pending'
  | 'capturing'
  | 'rendering'
  | 'encoding'
  | 'complete'
  | 'failed'

export interface RenderJob {
  id: string
  scriptId: string
  script: DemoScript
  status: JobStatus
  progress: number
  currentStep: string
  outputPath?: string
  downloadUrl?: string
  error?: string
  createdAt: string
  completedAt?: string
}

export interface CapturedElement {
  selector: string
  label: string
  boundingBox: { x: number; y: number; width: number; height: number }
  tagName: string
  innerText: string
}

export interface PageCapture {
  url: string
  screenshotBase64: string
  elements: CapturedElement[]
  pageHeight: number
  pageWidth: number
}
