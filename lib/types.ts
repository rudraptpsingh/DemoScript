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

export interface Step {
  id: string
  order: number
  target: string | null
  targetLabel: string
  action: ActionType
  duration: number
  zoom?: number
  easing?: 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
  annotation?: string
  highlightColor?: string
  scrollOffset?: number
  /** Text to type character-by-character (for type action) */
  typeText?: string
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
