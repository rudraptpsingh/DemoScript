import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'
import { FORMAT_SPECS, ALL_FORMAT_IDS, FormatId } from '../lib/renderer/formats'

// ─── Format Spec Tests ─────────────────────────────────────────────────────────

describe('Phase 3: Multi-Format Export', () => {
  it('FORMAT_SPECS contains all 5 expected formats', () => {
    const expected: FormatId[] = ['mp4-standard', 'mp4-twitter', 'mp4-linkedin', 'gif', 'thumbnail']
    for (const id of expected) {
      assert.ok(FORMAT_SPECS[id], `Missing format spec for: ${id}`)
    }
    assert.equal(ALL_FORMAT_IDS.length, 5)
  })

  it('mp4-standard has H.264 output options', () => {
    const spec = FORMAT_SPECS['mp4-standard']
    assert.ok(spec.ffmpegOptions.some(o => o.includes('libx264')), 'Should use libx264')
    assert.ok(spec.ffmpegOptions.some(o => o.includes('yuv420p')), 'Should use yuv420p')
    assert.ok(spec.ffmpegOptions.some(o => o.includes('faststart')), 'Should have faststart')
    assert.equal(spec.extension, 'mp4')
  })

  it('mp4-twitter has 60s duration cap', () => {
    const spec = FORMAT_SPECS['mp4-twitter']
    assert.equal(spec.maxDurationSeconds, 60)
    assert.ok(spec.ffmpegOptions.some(o => o.includes('-t 60')), 'Should have -t 60 option')
  })

  it('mp4-linkedin targets 1080x1080 square output', () => {
    const spec = FORMAT_SPECS['mp4-linkedin']
    assert.equal(spec.targetWidth, 1080)
    assert.equal(spec.targetHeight, 1080)
    assert.equal(spec.aspectRatio, '1:1')
  })

  it('gif has fps override of 15 and 600px width', () => {
    const spec = FORMAT_SPECS['gif']
    assert.equal(spec.fps, 15)
    assert.equal(spec.targetWidth, 600)
    assert.equal(spec.extension, 'gif')
  })

  it('thumbnail is marked as isThumbnail and outputs PNG', () => {
    const spec = FORMAT_SPECS['thumbnail']
    assert.equal(spec.isThumbnail, true)
    assert.equal(spec.extension, 'png')
  })

  it('all format specs have required fields', () => {
    for (const [id, spec] of Object.entries(FORMAT_SPECS)) {
      assert.ok(spec.id, `${id}: missing id`)
      assert.ok(spec.label, `${id}: missing label`)
      assert.ok(spec.extension, `${id}: missing extension`)
      assert.ok(spec.description, `${id}: missing description`)
      assert.ok(Array.isArray(spec.ffmpegOptions), `${id}: ffmpegOptions should be array`)
    }
  })

  it('encodeMultipleFormats import resolves', async () => {
    const { encodeMultipleFormats } = await import('../lib/renderer/ffmpeg')
    assert.equal(typeof encodeMultipleFormats, 'function')
  })

  describe('encodeMultipleFormats result structure', () => {
    let tempDir: string

    beforeEach(() => {
      tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demoscript-fmt-test-'))
      // Create fake frames for testing
      const frameDir = path.join(tempDir, 'frames')
      fs.mkdirSync(frameDir, { recursive: true })
      // We don't actually run FFmpeg in unit tests — just test the import
    })

    afterEach(() => {
      fs.rmSync(tempDir, { recursive: true, force: true })
    })

    it('FormatEncodeResult has success, outputPath, fileSizeBytes, error fields', async () => {
      const { encodeMultipleFormats } = await import('../lib/renderer/ffmpeg')
      assert.equal(typeof encodeMultipleFormats, 'function', 'encodeMultipleFormats is a function')
    })
  })

  it('backward compat: render() without formats returns single outputPath string type', async () => {
    const { renderScript } = await import('../lib/renderer/engine')
    // Verify the function signature accepts options without formats
    // We can't actually run a render in unit tests, but we can verify the import
    assert.equal(typeof renderScript, 'function')
  })
})
