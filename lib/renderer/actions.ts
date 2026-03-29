import { Page } from 'playwright'
import { Step } from '../types'

export interface ActionContext {
  page: Page
  step: Step
  frameDir: string
  fps: number
  frameCount: { value: number }
  viewport: { width: number; height: number }
}

async function captureFrames(
  ctx: ActionContext,
  durationSeconds: number,
  onFrame: (progress: number) => Promise<void>
): Promise<void> {
  const totalFrames = Math.max(1, Math.round(durationSeconds * ctx.fps))

  for (let i = 0; i < totalFrames; i++) {
    const progress = totalFrames === 1 ? 1 : i / (totalFrames - 1)
    const easedProgress = applyEasing(
      progress,
      ctx.step.easing || 'ease-in-out'
    )

    await onFrame(easedProgress)

    const frameNumber = String(ctx.frameCount.value).padStart(4, '0')
    const framePath = `${ctx.frameDir}/frame_${frameNumber}.png`
    await ctx.page.screenshot({ path: framePath, type: 'png' })
    ctx.frameCount.value++
  }
}

function applyEasing(t: number, easing: string): number {
  switch (easing) {
    case 'linear':
      return t
    case 'ease-in':
      return t * t
    case 'ease-out':
      return t * (2 - t)
    case 'ease-in-out':
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
    default:
      return t < 0.5 ? 2 * t * t : -1 + (4 - 2 * t) * t
  }
}

export async function actionScrollTo(ctx: ActionContext): Promise<void> {
  const { page, step } = ctx

  const targetY = await page.evaluate((selector) => {
    const el = selector ? document.querySelector(selector) : null
    if (!el) return 0
    const rect = el.getBoundingClientRect()
    return window.scrollY + rect.top - 80
  }, step.target)

  const startScrollY = await page.evaluate(() => window.scrollY)
  const endScrollY = targetY

  await captureFrames(ctx, step.duration, async (progress) => {
    const currentY = startScrollY + (endScrollY - startScrollY) * progress
    await page.evaluate((y) => window.scrollTo(0, y), currentY)
  })
}

export async function actionZoomIn(ctx: ActionContext): Promise<void> {
  const { page, step, viewport } = ctx
  const targetZoom = step.zoom || 2.0
  const startZoom = 1.0

  const elementCenter = await page.evaluate((selector) => {
    const el = selector ? document.querySelector(selector) : null
    if (!el) return { x: window.innerWidth / 2, y: window.innerHeight / 2 }
    const rect = el.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }, step.target)

  await captureFrames(ctx, step.duration, async (progress) => {
    const currentZoom = startZoom + (targetZoom - startZoom) * progress
    const originX = (elementCenter.x / viewport.width) * 100
    const originY = (elementCenter.y / viewport.height) * 100

    await page.evaluate(
      ({ zoom, ox, oy }) => {
        const body = document.body as HTMLElement
        body.style.transformOrigin = `${ox}% ${oy}%`
        body.style.transform = `scale(${zoom})`
        body.style.transition = 'none'
      },
      { zoom: currentZoom, ox: originX, oy: originY }
    )
  })
}

export async function actionZoomOut(ctx: ActionContext): Promise<void> {
  const { page, step } = ctx
  const startZoom = step.zoom || 2.0
  const endZoom = 1.0

  await captureFrames(ctx, step.duration, async (progress) => {
    const currentZoom = startZoom + (endZoom - startZoom) * progress
    await page.evaluate((zoom) => {
      const body = document.body as HTMLElement
      body.style.transform = zoom === 1.0 ? '' : `scale(${zoom})`
      body.style.transition = 'none'
    }, currentZoom)
  })
}

export async function actionHighlight(ctx: ActionContext): Promise<void> {
  const { page, step } = ctx
  const color = step.highlightColor || '#3B82F6'

  await page.evaluate(
    ({ selector, color }) => {
      const existing = document.getElementById('__demoscript_highlight')
      if (existing) existing.remove()

      const el = selector ? document.querySelector(selector) : null
      if (!el) return

      const rect = el.getBoundingClientRect()
      const overlay = document.createElement('div')
      overlay.id = '__demoscript_highlight'
      overlay.style.cssText = `
      position: fixed;
      left: ${rect.left - 4}px;
      top: ${rect.top - 4}px;
      width: ${rect.width + 8}px;
      height: ${rect.height + 8}px;
      border: 3px solid ${color};
      border-radius: 6px;
      background: ${color}22;
      pointer-events: none;
      z-index: 999999;
      box-shadow: 0 0 0 4px ${color}44;
    `
      document.body.appendChild(overlay)
    },
    { selector: step.target, color }
  )

  await captureFrames(ctx, step.duration, async (progress) => {
    let opacity = 1
    if (progress < 0.2) opacity = progress / 0.2
    else if (progress > 0.8) opacity = (1 - progress) / 0.2

    await page.evaluate((op) => {
      const el = document.getElementById('__demoscript_highlight')
      if (el) el.style.opacity = String(op)
    }, opacity)
  })

  await page.evaluate(() => {
    document.getElementById('__demoscript_highlight')?.remove()
  })
}

export async function actionWait(ctx: ActionContext): Promise<void> {
  await captureFrames(ctx, ctx.step.duration, async () => {
    // No-op — just capture the current state
  })
}

export async function actionPan(ctx: ActionContext): Promise<void> {
  const { page, step, viewport } = ctx

  const targetElement = await page.evaluate((selector) => {
    const el = selector ? document.querySelector(selector) : null
    if (!el) return null
    const rect = el.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }, step.target)

  if (!targetElement) return

  const startX = await page.evaluate(() => window.scrollX)
  const startY = await page.evaluate(() => window.scrollY)
  const endX = Math.max(0, targetElement.x - viewport.width / 2)
  const endY = Math.max(0, targetElement.y - viewport.height / 2)

  await captureFrames(ctx, step.duration, async (progress) => {
    const x = startX + (endX - startX) * progress
    const y = startY + (endY - startY) * progress
    await page.evaluate(({ x, y }) => window.scrollTo(x, y), { x, y })
  })
}

export async function actionCursorMove(ctx: ActionContext): Promise<void> {
  const { page, step, viewport } = ctx

  const targetPos = await page.evaluate((selector) => {
    const el = selector ? document.querySelector(selector) : null
    if (!el) return { x: 100, y: 100 }
    const rect = el.getBoundingClientRect()
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 }
  }, step.target)

  const startX = viewport.width / 2
  const startY = viewport.height / 2

  await captureFrames(ctx, step.duration, async (progress) => {
    const x = startX + (targetPos.x - startX) * progress
    const y = startY + (targetPos.y - startY) * progress
    await page.mouse.move(x, y)
  })
}

export async function injectAnnotation(
  page: Page,
  text: string
): Promise<void> {
  await page.evaluate((annotationText) => {
    const existing = document.getElementById('__demoscript_annotation')
    if (existing) existing.remove()

    const el = document.createElement('div')
    el.id = '__demoscript_annotation'
    el.textContent = annotationText
    el.style.cssText = `
      position: fixed;
      bottom: 32px;
      left: 50%;
      transform: translateX(-50%);
      background: rgba(0, 0, 0, 0.85);
      color: white;
      padding: 12px 24px;
      border-radius: 8px;
      font-family: -apple-system, sans-serif;
      font-size: 16px;
      font-weight: 500;
      z-index: 999999;
      backdrop-filter: blur(8px);
      border: 1px solid rgba(255,255,255,0.1);
      max-width: 600px;
      text-align: center;
      pointer-events: none;
    `
    document.body.appendChild(el)
  }, text)
}

export async function removeAnnotation(page: Page): Promise<void> {
  await page.evaluate(() => {
    document.getElementById('__demoscript_annotation')?.remove()
  })
}

export async function executeAction(ctx: ActionContext): Promise<void> {
  // Inject annotation if present
  if (ctx.step.annotation) {
    await injectAnnotation(ctx.page, ctx.step.annotation)
  }

  switch (ctx.step.action) {
    case 'scroll-to':
      return actionScrollTo(ctx)
    case 'zoom-in':
      return actionZoomIn(ctx)
    case 'zoom-out':
      return actionZoomOut(ctx)
    case 'highlight':
      return actionHighlight(ctx)
    case 'wait':
      return actionWait(ctx)
    case 'pan':
      return actionPan(ctx)
    case 'cursor-move':
      return actionCursorMove(ctx)
    default:
      return actionWait(ctx)
  }
}
