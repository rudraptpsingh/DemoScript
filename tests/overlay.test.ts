/**
 * On-screen text: the rules that keep it readable.
 *
 * Type is specified as a share of frame height, so the same script stays
 * legible whether it renders at 720p for a blog embed or at 1920 tall for a
 * phone-shaped reel.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { captionFontPx, titleFontPx, fadeOpacity, TEXT_SCALE } from '../lib/renderer/overlay'

describe('text sizing', () => {
  it('scales with the frame rather than staying a fixed pixel size', () => {
    const small = captionFontPx(720)
    const tall = captionFontPx(1920)
    assert.ok(tall > small * 1.5, `expected the reel-height caption to grow: ${small} -> ${tall}`)
  })

  it('stays legible on a small frame and restrained on a huge one', () => {
    assert.ok(captionFontPx(320) >= TEXT_SCALE.captionMin, 'tiny frames still get readable text')
    assert.equal(captionFontPx(8000), TEXT_SCALE.captionMax, 'huge frames stop growing')
  })

  it('a caption at 844p lands in the readable band for video', () => {
    // 29px on a 1318x844 app recording: comfortably above the ~16px that made
    // the first ShotSelect render unreadable when scaled down.
    const px = captionFontPx(844)
    assert.ok(px >= 26 && px <= 32, `expected roughly 29px, got ${px}`)
  })

  it('title cards outrank captions at the same frame size', () => {
    assert.ok(titleFontPx(844) > captionFontPx(844) * 1.8, 'a story card should dominate')
  })
})

describe('text fades', () => {
  it('starts and ends invisible, and is fully opaque in the middle', () => {
    assert.equal(fadeOpacity(0, 2), 0)
    assert.equal(fadeOpacity(1, 2), 0)
    assert.equal(fadeOpacity(0.5, 2), 1)
  })

  it('ramps rather than popping', () => {
    const early = fadeOpacity(0.02, 2)
    assert.ok(early > 0 && early < 1, `expected a partial fade, got ${early}`)
  })

  it('shortens the fade on a short step so text is not always mid-fade', () => {
    // A 0.4s step must still reach full opacity somewhere in the middle.
    assert.equal(fadeOpacity(0.5, 0.4), 1)
  })
})
