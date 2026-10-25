/**
 * Recording an app that does real work: wait-for skips the wait, screencast
 * capture records in real time, record: false keeps setup out, and markers
 * say where each step landed. The renders run Chromium + FFmpeg on a page
 * that "finishes" a job after a few seconds, like a backup or an export.
 */
import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import os from 'os'
import path from 'path'
import { execFileSync } from 'child_process'
import ffmpegPath from '@ffmpeg-installer/ffmpeg'
import { renderScript } from '../lib/renderer/engine'
import { resampleFrames, recordedSeconds } from '../lib/renderer/live'
import { skipCardText, toVtt } from '../lib/renderer/markers'
import { waitForCheck } from '../lib/renderer/actions'
import { toStep, type StepInput } from '../pkg/index'
import type { DemoScript } from '../lib/types'

describe('resampleFrames', () => {
  const frames = [
    { file: 'a', ts: 10 },
    { file: 'b', ts: 10.5 },
    { file: 'c', ts: 20 },
  ]

  it('shows the latest frame at each tick and holds it while the page is still', () => {
    assert.deepEqual(resampleFrames(frames, [{ start: 10, end: 11 }], 4), ['a', 'a', 'b', 'b'])
  })

  it('leaves the paused time out: two segments, no ticks for the gap between them', () => {
    const out = resampleFrames(
      frames,
      [
        { start: 10, end: 10.5 },
        { start: 20, end: 20.5 },
      ],
      4
    )
    assert.deepEqual(out, ['a', 'a', 'c', 'c'])
    assert.equal(recordedSeconds([{ start: 10, end: 10.5 }, { start: 20, end: 20.5 }]), 1)
  })

  it('a segment that opens before any frame shows the first frame', () => {
    assert.deepEqual(resampleFrames(frames, [{ start: 9, end: 9.5 }], 2), ['a'])
  })
})

describe('skipCardText', () => {
  it('rounds to minutes for long waits and keeps seconds for short ones', () => {
    assert.equal(skipCardText(57 * 60 + 20, true), '57 min later')
    assert.equal(skipCardText(42, true), '42 s later')
    assert.equal(skipCardText(3600, 'About {minutes} minutes in'), 'About 60 minutes in')
  })
})

describe('toVtt', () => {
  it('writes one cue per annotated step, at its place in the video', () => {
    const vtt = toVtt([
      { index: 0, action: 'title', label: '', start: 0, end: 1.5, annotation: 'Back up a card' },
      { index: 1, action: 'wait-for', label: '', start: 1.5, end: 2.7 },
      { index: 2, action: 'wait', label: '', start: 2.7, end: 61.25, annotation: 'Checked' },
    ])
    assert.equal(
      vtt,
      'WEBVTT\n\n00:00:00.000 --> 00:00:01.500\nBack up a card\n\n00:00:02.700 --> 00:01:01.250\nChecked\n'
    )
  })
})

describe('waitForCheck', () => {
  const run = (check: string, body: string, el: { width: number; height: number } | null) =>
    new Function('document', `return ${check}`)({
      body: { innerText: body },
      querySelector: () => (el ? { getBoundingClientRect: () => el } : null),
    })

  it('needs every condition it is given', () => {
    const check = waitForCheck({ selector: '#done', text: 'Backed up' })
    assert.equal(run(check, 'Backed up and checked', { width: 10, height: 10 }), true)
    assert.equal(run(check, 'Copying…', { width: 10, height: 10 }), false)
    assert.equal(run(check, 'Backed up and checked', null), false)
    // Present but hidden is not done yet.
    assert.equal(run(check, 'Backed up and checked', { width: 0, height: 0 }), false)
  })

  it('refuses a wait-for with nothing to wait for', () => {
    assert.throws(() => waitForCheck({}), /needs until/)
  })
})

describe('toStep', () => {
  it('passes every script field through, including ones the old mappings dropped', () => {
    const input: StepInput = {
      action: 'wait-for',
      duration: 1.2,
      until: { text: 'Backed up' },
      timeout: 4000,
      skipCard: true,
      record: false,
      typeText: 'hello',
      scrollOffset: 40,
    }
    const step = toStep(input, 2, 'x')
    assert.deepEqual(step.until, { text: 'Backed up' })
    assert.equal(step.skipCard, true)
    assert.equal(step.record, false)
    assert.equal(step.typeText, 'hello')
    assert.equal(step.scrollOffset, 40)
    assert.equal(step.order, 3)
    assert.equal(step.target, null)
  })
})

// ─── Renders ───────────────────────────────────────────────────────────────────

/** A page that "copies" for JOB_MS, then says it is done. */
const JOB_MS = 6000
const PAGE = `data:text/html,${encodeURIComponent(`<!doctype html><body style="margin:0;background:#111;color:#eee;font:40px system-ui">
<h1 id="status">Copying 0 files</h1>
<script>
  let n = 0; const t0 = Date.now()
  const tick = setInterval(() => {
    document.getElementById('status').textContent = 'Copying ' + (++n) + ' files'
    if (Date.now() - t0 > ${JOB_MS}) {
      clearInterval(tick)
      const done = document.createElement('div'); done.id = 'done'; done.textContent = 'Backed up and checked'
      // A solid block the test can find in the last frame.
      done.style.cssText = 'position:fixed;top:0;right:0;width:160px;height:100px;background:#00ff00;color:#00ff00'
      document.body.appendChild(done)
    }
  }, 100)
</script></body>`)}`

function videoSeconds(file: string): number {
  let out = ''
  try {
    execFileSync(ffmpegPath.path, ['-hide_banner', '-i', file], { stdio: 'pipe' })
  } catch (err) {
    out = String((err as { stderr?: Buffer }).stderr ?? '')
  }
  const m = out.match(/Duration: (\d+):(\d+):([\d.]+)/)
  assert.ok(m, `no duration for ${file}`)
  return Number(m[1]) * 3600 + Number(m[2]) * 60 + Number(m[3])
}

/** Mean colour of the top-right corner of the video's last frame. */
function lastFrameCorner(file: string): { r: number; g: number; b: number } {
  const rgb = execFileSync(ffmpegPath.path, [
    '-hide_banner', '-loglevel', 'error', '-sseof', '-0.2', '-i', file,
    '-vf', 'crop=iw/8:ih/8:iw-iw/8:0,scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ])
  return { r: rgb[0], g: rgb[1], b: rgb[2] }
}

function script(capture: DemoScript['capture'], steps: StepInput[]): DemoScript {
  return {
    id: `live_${capture}_${Date.now()}`,
    url: PAGE,
    capture,
    viewport: { width: 640, height: 400 },
    fps: 12,
    outputFormat: 'mp4',
    steps: steps.map((s, i) => toStep(s, i)),
    createdAt: new Date().toISOString(),
  }
}

const JOB: StepInput[] = [
  { action: 'wait', duration: 1, annotation: 'Start the backup' },
  { action: 'wait-for', duration: 1, until: { selector: '#done' }, skipCard: true, timeout: 20 },
  { action: 'wait', duration: 1, annotation: 'Backed up' },
]

for (const capture of ['screencast', 'frames'] as const) {
  describe(`render · ${capture}`, () => {
    it('the video leaves the wait out and the markers say where each step is', { timeout: 60_000 }, async () => {
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-live-'))
      const file = (await renderScript({ script: script(capture, JOB), outputDir: out })) as string
      // 1 s + 1 s card + 1 s; the ~5 s the job still needed after step 1 is not in it.
      const seconds = videoSeconds(file)
      assert.ok(seconds > 2.6 && seconds < 3.6, `video is ${seconds}s`)
      const markers = JSON.parse(fs.readFileSync(file.replace(/\.mp4$/, '.steps.json'), 'utf8'))
      assert.deepEqual(markers.map((m: { action: string }) => m.action), ['wait', 'wait-for', 'wait'])
      // The job's "done" block is in the last frame: the render really waited.
      const corner = lastFrameCorner(file)
      assert.ok(corner.g > 180 && corner.r < 90, `last frame corner is ${JSON.stringify(corner)}`)
      assert.ok(Math.abs(markers[1].end - markers[1].start - 1) < 0.35, JSON.stringify(markers[1]))
      assert.match(fs.readFileSync(file.replace(/\.mp4$/, '.vtt'), 'utf8'), /Backed up/)
      fs.rmSync(out, { recursive: true, force: true })
    })
  })
}

describe('render · record: false', () => {
  it('runs a setup step without putting it in the video', { timeout: 60_000 }, async () => {
    const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-live-'))
    const file = (await renderScript({
      script: script('screencast', [
        { action: 'wait', duration: 2, record: false },
        { action: 'wait', duration: 1 },
      ]),
      outputDir: out,
    })) as string
    const seconds = videoSeconds(file)
    assert.ok(seconds > 0.7 && seconds < 1.4, `video is ${seconds}s`)
    fs.rmSync(out, { recursive: true, force: true })
  })
})

// ─── press ─────────────────────────────────────────────────────────────────────

/**
 * Turns the corner green only after ArrowRight ×3 and then '3' as Digit3 —
 * the code a keyboard-bound app (star ratings) actually matches on — with at
 * least `gapMs` between presses. Only screencast runs on the wall clock;
 * frames mode presses as fast as it can take screenshots.
 */
const keysPage = (gapMs: number) => `data:text/html,${encodeURIComponent(`<!doctype html><body style="margin:0;background:#111">
<script>
  const keys = []
  let last = 0, spaced = true
  addEventListener('keydown', (e) => {
    const now = performance.now()
    if (keys.length && now - last < ${gapMs}) spaced = false
    last = now
    keys.push(e.key + '/' + e.code)
    if (spaced && keys.join(' ') === 'ArrowRight/ArrowRight ArrowRight/ArrowRight ArrowRight/ArrowRight 3/Digit3') {
      const done = document.createElement('div')
      done.style.cssText = 'position:fixed;top:0;right:0;width:160px;height:100px;background:#00ff00'
      document.body.appendChild(done)
    }
  })
</script></body>`)}`

const PRESSES: StepInput[] = [
  { action: 'press', key: 'ArrowRight', repeat: 3, interval: 0.5, duration: 0 },
  { action: 'press', key: '3', duration: 0.6 },
]

describe('press', () => {
  it('refuses a press with no key', async () => {
    const { actionPress } = await import('../lib/renderer/actions')
    const ctx = { page: {}, step: toStep({ action: 'press', duration: 1 }, 0, 'p') } as never
    await assert.rejects(actionPress(ctx), /has no key/)
  })
})

for (const capture of ['screencast', 'frames'] as const) {
  describe(`render · press · ${capture}`, () => {
    it('presses each key the right number of times, interval apart', { timeout: 60_000 }, async () => {
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-press-'))
      const file = (await renderScript({
        script: { ...script(capture, PRESSES), url: keysPage(capture === 'screencast' ? 300 : 0) },
        outputDir: out,
      })) as string
      // 3 × 0.5 s + 0.6 s.
      const seconds = videoSeconds(file)
      assert.ok(seconds > 1.8 && seconds < 2.6, `video is ${seconds}s`)
      const corner = lastFrameCorner(file)
      assert.ok(corner.g > 180 && corner.r < 90, `last frame corner is ${JSON.stringify(corner)}`)
      fs.rmSync(out, { recursive: true, force: true })
    })
  })
}

// ─── captions on click, hover and type ─────────────────────────────────────────

/** A red page with a button and a field, so a caption's dark scrim shows as a drop in red. */
const RED_PAGE = `data:text/html,${encodeURIComponent(`<!doctype html><body style="margin:0;background:#ff0000">
<button id="btn" style="position:fixed;top:20px;left:20px;width:120px;height:40px">Go</button>
<input id="field" style="position:fixed;top:20px;left:200px;width:160px;height:30px">
</body>`)}`

/** Mean red at the centre of where a bottom caption sits (640 x 400 viewport), at time `t`. */
function captionBandRed(file: string, t: number): number {
  const rgb = execFileSync(ffmpegPath.path, [
    '-hide_banner', '-loglevel', 'error', '-ss', String(t), '-i', file,
    '-vf', 'crop=iw/16:ih/20:iw*0.47:ih*0.86,scale=1:1', '-frames:v', '1', '-f', 'rawvideo', '-pix_fmt', 'rgb24', '-',
  ])
  return rgb[0]
}

const CAPTIONED: StepInput[] = [
  { action: 'click', target: '#btn', duration: 1.6, annotation: 'Clicked' },
  { action: 'hover', target: '#btn', duration: 1.6, annotation: 'Hovered' },
  { action: 'type', target: '#field', typeText: 'hello', duration: 1.6, annotation: 'Typed' },
  { action: 'wait', duration: 0.8 },
]

for (const capture of ['screencast', 'frames'] as const) {
  describe(`render · captions · ${capture}`, () => {
    it('shows the caption of a click, a hover and a type step while it runs', { timeout: 60_000 }, async () => {
      const out = fs.mkdtempSync(path.join(os.tmpdir(), 'ds-caption-'))
      const file = (await renderScript({
        script: { ...script(capture, CAPTIONED), url: RED_PAGE },
        outputDir: out,
      })) as string
      const markers = JSON.parse(fs.readFileSync(file.replace(/\.mp4$/, '.steps.json'), 'utf8'))
      // The plain wait has no caption: the band stays red.
      const bare = captionBandRed(file, (markers[3].start + markers[3].end) / 2)
      assert.ok(bare > 230, `uncaptioned band red is ${bare}`)
      for (const m of markers.slice(0, 3)) {
        const red = captionBandRed(file, (m.start + m.end) / 2)
        assert.ok(red < bare - 40, `${m.action} caption not visible: band red ${red} vs ${bare}`)
      }
      fs.rmSync(out, { recursive: true, force: true })
    })
  })
}
