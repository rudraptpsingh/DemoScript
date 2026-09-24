/**
 * Camera motion: the properties a viewer actually notices.
 *
 * These pin what makes a zoom read as smooth — it starts and ends at rest,
 * lands the target in the frame, and never shows the page edge — rather than
 * only that a video file comes out the other end.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { applyEasing, cameraFor, focusOf, type Stage } from '../lib/renderer/actions'

const FRAMES = 42 // a 1.4s zoom at 30fps

/** A 1280x800 app whose body fills the window, like an Electron shell. */
function stage(target: Stage['target']): Stage {
  return { vw: 1280, vh: 800, bx: 0, by: 0, cw: 1280, ch: 800, target, camera: { s: 1, tx: 0, ty: 0 } }
}

/** Where an untransformed rect lands on screen under a camera. */
function onScreen(st: Stage, cam: { s: number; tx: number; ty: number }, r: { x: number; y: number; w: number; h: number }) {
  const x = st.bx + cam.tx + (r.x - st.bx) * cam.s
  const y = st.by + cam.ty + (r.y - st.by) * cam.s
  return { x, y, w: r.w * cam.s, h: r.h * cam.s }
}

describe('camera easing', () => {
  it('smooth starts and ends at rest', () => {
    const step = 1 / (FRAMES - 1)
    const first = applyEasing(step, 'smooth') - applyEasing(0, 'smooth')
    const last = applyEasing(1, 'smooth') - applyEasing(1 - step, 'smooth')
    // A curve that jumps off the mark is what reads as a jerk: ease-out-expo
    // covers ~21% of the move in this first step.
    assert.ok(first < 0.002, `first frame moves ${(first * 100).toFixed(2)}% of the zoom`)
    assert.ok(last < 0.002, `last frame moves ${(last * 100).toFixed(2)}% of the zoom`)
  })

  it('an unknown easing falls back to the smooth curve, not a lurching one', () => {
    const step = 1 / (FRAMES - 1)
    assert.equal(applyEasing(step, 'no-such-curve'), applyEasing(step, 'smooth'))
  })

  it('ease-out-expo really does lurch — the reason it is not the default', () => {
    const first = applyEasing(1 / (FRAMES - 1), 'ease-out-expo')
    assert.ok(first > 0.15, `expected a large first step, got ${(first * 100).toFixed(1)}%`)
  })
})

describe('camera framing', () => {
  it('centres a target that has room around it', () => {
    const target = { x: 600, y: 380, w: 80, h: 40 }
    const st = stage(target)
    const cam = cameraFor(st, 3, target.x + target.w / 2, target.y + target.h / 2)
    const r = onScreen(st, cam, target)
    assert.ok(Math.abs(r.x + r.w / 2 - 640) < 0.5, 'target is centred horizontally')
    assert.ok(Math.abs(r.y + r.h / 2 - 400) < 0.5, 'target is centred vertically')
  })

  it('keeps a target near the top edge fully in frame instead of pushing it off', () => {
    // The case that clipped in practice: a panel hugging the top of the window.
    const target = { x: 1100, y: 10, w: 160, h: 120 }
    const st = stage(target)
    const cam = cameraFor(st, 4, target.x + target.w / 2, target.y + target.h / 2)
    const r = onScreen(st, cam, target)
    assert.ok(r.y >= -0.5, `top is off screen by ${(-r.y).toFixed(1)}px`)
    assert.ok(r.x + r.w <= 1280.5, `right edge is off screen by ${(r.x + r.w - 1280).toFixed(1)}px`)
  })

  it('never reveals past the edge of the page', () => {
    const corner = { x: 0, y: 0, w: 50, h: 30 }
    const st = stage(corner)
    for (const s of [1.2, 2, 4]) {
      const cam = cameraFor(st, s, 25, 15)
      assert.ok(cam.tx <= 0.001 && cam.ty <= 0.001, `page edge slid into view at ${s}x`)
      assert.ok(cam.tx + 1280 * s >= 1280 - 0.001, `right edge slid into view at ${s}x`)
      assert.ok(cam.ty + 800 * s >= 800 - 0.001, `bottom edge slid into view at ${s}x`)
    }
  })

  it('reads back the point it was told to centre', () => {
    const st = stage(null)
    const cam = cameraFor(st, 2.5, 640, 400)
    const f = focusOf(st, cam)
    assert.ok(Math.abs(f.x - 640) < 1e-6 && Math.abs(f.y - 400) < 1e-6)
  })
})
