export type ActionType =
  | 'scroll-to'
  | 'zoom-in'
  | 'zoom-out'
  | 'highlight'
  | 'pan'
  | 'cursor-move'
  | 'wait'
  | 'click'

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
}

export interface DemoScript {
  id: string
  url: string
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
