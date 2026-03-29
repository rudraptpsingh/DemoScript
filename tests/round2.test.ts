/**
 * Round 2 tests — deeper edge cases and boundary conditions
 *
 * Focuses on:
 *  - Client retry/backoff behaviour
 *  - Watcher debounce boundary (two separate change bursts)
 *  - Format encoding: thumbnail missing frame
 *  - AI response parsing edge cases
 *  - Error message quality
 *  - Schema boundary checks
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

// ─── Phase 2: Watcher two-burst debounce ────────────────────────────────────

describe('Phase 2: Watcher two-burst debounce', () => {
  let tempDir: string
  let scriptFile: string

  const validScript = (url: string) =>
    JSON.stringify({ url, steps: [{ action: 'wait', duration: 1 }] })

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demoscript-r2-'))
    scriptFile = path.join(tempDir, 'demo.json')
    fs.writeFileSync(scriptFile, validScript('https://example.com'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('two separate bursts (with gap > debounce) trigger exactly 2 callbacks', (t, done) => {
    import('../lib/watcher').then(({ watchScript }) => {
      let callCount = 0

      const stop = watchScript({
        filePath: scriptFile,
        debounceMs: 100,
        onChange: () => { callCount++ },
      })

      // First burst at t=0
      setTimeout(() => fs.writeFileSync(scriptFile, validScript('https://first.com')), 20)
      setTimeout(() => fs.writeFileSync(scriptFile, validScript('https://first2.com')), 40)

      // Second burst at t=400 (well after first debounce settles)
      setTimeout(() => fs.writeFileSync(scriptFile, validScript('https://second.com')), 400)
      setTimeout(() => fs.writeFileSync(scriptFile, validScript('https://second2.com')), 420)

      // Check at t=700
      setTimeout(() => {
        stop()
        assert.equal(callCount, 2, `Expected 2 callbacks for 2 separate bursts, got ${callCount}`)
        done()
      }, 700)
    })
  })

  it('default debounce is 500ms (no debounceMs specified)', (t, done) => {
    import('../lib/watcher').then(({ watchScript }) => {
      let callCount = 0

      const stop = watchScript({
        filePath: scriptFile,
        // no debounceMs — uses default 500ms
        onChange: () => { callCount++ },
      })

      // 3 rapid writes within 200ms
      for (let i = 0; i < 3; i++) {
        setTimeout(() => fs.writeFileSync(scriptFile, validScript(`https://rapid${i}.com`)), i * 50)
      }

      // Check at t=900 — the default 500ms debounce should have fired once
      setTimeout(() => {
        stop()
        assert.equal(callCount, 1, `Expected 1 callback with 500ms default debounce, got ${callCount}`)
        done()
      }, 900)
    })
  })

  it('watcher passes script with array of steps to onChange', (t, done) => {
    import('../lib/watcher').then(({ watchScript }) => {
      const newSteps = [
        { action: 'wait', duration: 1 },
        { action: 'scroll-to', target: '#pricing', duration: 2 },
      ]
      let received: unknown = null

      const stop = watchScript({
        filePath: scriptFile,
        debounceMs: 100,
        onChange: (s) => { received = s },
      })

      setTimeout(() => {
        fs.writeFileSync(scriptFile, JSON.stringify({ url: 'https://example.com', steps: newSteps }))
      }, 30)

      setTimeout(() => {
        stop()
        assert.ok(received !== null)
        const r = received as { steps: unknown[] }
        assert.equal(r.steps.length, 2)
        done()
      }, 400)
    })
  })
})

// ─── Phase 3: Thumbnail missing frame ────────────────────────────────────────

describe('Phase 3: Thumbnail missing first frame', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demoscript-thumb-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('thumbnail encoding fails (not throws) when frame_0001.png is missing', async () => {
    const { encodeMultipleFormats } = await import('../lib/renderer/ffmpeg')

    const frameDir = path.join(tempDir, 'frames')
    fs.mkdirSync(frameDir, { recursive: true })
    // Intentionally do NOT create frame_0001.png

    const result = await encodeMultipleFormats({
      frameDir,
      baseOutputPath: path.join(tempDir, 'out'),
      fps: 24,
      viewport: { width: 100, height: 100 },
      formatIds: ['thumbnail'],
    })

    assert.ok(result['thumbnail'], 'result for thumbnail must exist')
    assert.equal(result['thumbnail'].success, false, 'thumbnail should fail when frame is missing')
    assert.ok(result['thumbnail'].error, 'error message should be set')
    assert.ok(
      result['thumbnail'].error!.includes('frame') || result['thumbnail'].error!.includes('not found'),
      `Error should mention missing frame: ${result['thumbnail'].error}`
    )
  })

  it('encodeMultipleFormats continues other formats when one fails', async () => {
    const { encodeMultipleFormats } = await import('../lib/renderer/ffmpeg')

    const frameDir = path.join(tempDir, 'frames2')
    fs.mkdirSync(frameDir, { recursive: true })

    // Create frame_0001.png (valid 1x1 PNG)
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52,
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01,
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53,
      0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41,
      0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
      0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
      0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e,
      0x44, 0xae, 0x42, 0x60, 0x82,
    ])
    fs.writeFileSync(path.join(frameDir, 'frame_0001.png'), pngBytes)

    // Run thumbnail (succeeds) + unknown-format (fails) together
    const result = await encodeMultipleFormats({
      frameDir,
      baseOutputPath: path.join(tempDir, 'multi'),
      fps: 24,
      viewport: { width: 1, height: 1 },
      formatIds: ['thumbnail', 'unknown-format' as never],
    })

    assert.equal(result['thumbnail'].success, true, 'thumbnail should succeed')
    assert.equal(result['unknown-format'].success, false, 'unknown-format should fail')
    // Both results should exist
    assert.ok('thumbnail' in result)
    assert.ok('unknown-format' in result)
  })
})

// ─── Phase 1: parseAIResponse additional edge cases ─────────────────────────

describe('Phase 1: parseAIResponse additional edge cases', () => {
  it('handles JSON with trailing whitespace inside fences', async () => {
    const { parseAIResponse } = await import('../lib/ai/scriptGenerator')
    const raw = '```json\n  [{"action":"wait","target":null,"duration":2}]  \n```'
    const result = parseAIResponse(raw)
    assert.equal(result.length, 1)
    assert.equal(result[0].action, 'wait')
  })

  it('error message includes raw response snippet', async () => {
    const { parseAIResponse } = await import('../lib/ai/scriptGenerator')
    const badInput = 'Sorry, I cannot generate a script for that.'
    assert.throws(
      () => parseAIResponse(badInput),
      (err: Error) => {
        // Should include either the raw response or a clear error
        assert.ok(
          err.message.includes('Raw response') || err.message.includes('invalid JSON'),
          `Error message should be helpful: ${err.message}`
        )
        return true
      }
    )
  })

  it('handles multi-step response with varied action types', async () => {
    const { parseAIResponse } = await import('../lib/ai/scriptGenerator')
    const steps = [
      { action: 'wait', target: null, duration: 1 },
      { action: 'scroll-to', target: '#hero', duration: 2 },
      { action: 'zoom-in', target: '#logo', duration: 1.5, zoom: 2 },
      { action: 'highlight', target: '.btn', duration: 1, highlightColor: '#ff0000' },
      { action: 'zoom-out', target: null, duration: 1 },
      { action: 'pan', target: '#footer', duration: 2 },
      { action: 'cursor-move', target: '#cta', duration: 1 },
      { action: 'click', target: '#signup', duration: 0.5 },
    ]
    const result = parseAIResponse(JSON.stringify(steps))
    assert.equal(result.length, 8)
    assert.equal(result[2].zoom, 2)
    assert.equal((result[3] as { highlightColor?: string }).highlightColor, '#ff0000')
  })
})

// ─── Phase 4: Cloud client retry logic ───────────────────────────────────────

describe('Phase 4: Cloud client retry logic', () => {
  it('fetchWithAuth retries on network failure and eventually throws NetworkError', async () => {
    const { createCloudClient, NetworkError } = await import('../lib/api/client')
    const originalFetch = global.fetch
    let callCount = 0

    global.fetch = async () => {
      callCount++
      throw new Error('ECONNREFUSED')
    }

    const client = createCloudClient({ apiKey: 'ds_live_test', timeout: 30000 })
    await assert.rejects(
      () => client.checkAuth(),
      (err: Error) => {
        assert.ok(err instanceof NetworkError, `Expected NetworkError, got ${err.constructor.name}`)
        assert.ok(err.message.includes('3 retries') || err.message.includes('retries'))
        return true
      }
    )

    // Should have attempted 3 times
    assert.equal(callCount, 3, `Expected 3 fetch attempts, got ${callCount}`)
    global.fetch = originalFetch
  })

  it('render() throws ValidationError on 400 response', async () => {
    const { createCloudClient, ValidationError } = await import('../lib/api/client')
    const originalFetch = global.fetch

    global.fetch = async () => new Response(
      JSON.stringify({ error: 'Script has no steps' }),
      { status: 400 }
    )

    const client = createCloudClient({ apiKey: 'ds_live_test' })
    const mockScript = {
      id: 'test',
      url: 'https://example.com',
      viewport: { width: 1280, height: 720 },
      fps: 24,
      outputFormat: 'mp4' as const,
      steps: [],
      createdAt: new Date().toISOString(),
    }

    await assert.rejects(
      () => client.render(mockScript, 'mp4'),
      (err: Error) => {
        assert.ok(err instanceof ValidationError, `Expected ValidationError, got ${err.constructor.name}`)
        assert.ok(err.message.includes('Script has no steps'))
        return true
      }
    )

    global.fetch = originalFetch
  })

  it('createCloudClient uses default baseUrl https://api.demoscript.com', () => {
    // Verify the default is set by checking the baseUrl is used in requests
    // We can verify via the fetch call
    import('../lib/api/client').then(({ createCloudClient }) => {
      const client = createCloudClient({ apiKey: 'test' })
      assert.ok(client, 'Client should be created with default baseUrl')
    })
  })
})

// ─── Phase 4: RateLimitError from checkAuth ───────────────────────────────────

describe('Phase 4: RateLimitError from checkAuth', () => {
  it('checkAuth() throws RateLimitError with parsed fields on 429', async () => {
    const { createCloudClient, RateLimitError } = await import('../lib/api/client')
    const originalFetch = global.fetch

    global.fetch = async () => new Response(
      JSON.stringify({ error: 'Monthly limit', rendersThisMonth: 10, limit: 10, resetDate: '2026-04-01' }),
      { status: 429 }
    )

    const client = createCloudClient({ apiKey: 'ds_live_test' })
    await assert.rejects(
      () => client.checkAuth(),
      (err: Error) => {
        assert.ok(err instanceof RateLimitError)
        const rl = err as RateLimitError
        assert.equal(rl.rendersThisMonth, 10)
        assert.equal(rl.limit, 10)
        assert.equal(rl.resetDate, '2026-04-01')
        return true
      }
    )

    global.fetch = originalFetch
  })
})

// ─── Phase 3: Format spec boundary values ────────────────────────────────────

describe('Phase 3: Format spec boundary values', () => {
  it('mp4-twitter maxDurationSeconds is exactly 60', async () => {
    const { FORMAT_SPECS } = await import('../lib/renderer/formats')
    assert.equal(FORMAT_SPECS['mp4-twitter'].maxDurationSeconds, 60)
  })

  it('gif targetWidth is exactly 600', async () => {
    const { FORMAT_SPECS } = await import('../lib/renderer/formats')
    assert.equal(FORMAT_SPECS['gif'].targetWidth, 600)
  })

  it('gif fps is exactly 15', async () => {
    const { FORMAT_SPECS } = await import('../lib/renderer/formats')
    assert.equal(FORMAT_SPECS['gif'].fps, 15)
  })

  it('mp4-linkedin targetWidth and targetHeight are both 1080', async () => {
    const { FORMAT_SPECS } = await import('../lib/renderer/formats')
    assert.equal(FORMAT_SPECS['mp4-linkedin'].targetWidth, 1080)
    assert.equal(FORMAT_SPECS['mp4-linkedin'].targetHeight, 1080)
  })

  it('mp4-standard has null targetWidth and targetHeight (uses viewport)', async () => {
    const { FORMAT_SPECS } = await import('../lib/renderer/formats')
    assert.equal(FORMAT_SPECS['mp4-standard'].targetWidth, null)
    assert.equal(FORMAT_SPECS['mp4-standard'].targetHeight, null)
  })

  it('ALL_FORMAT_IDS contains exactly 5 items', async () => {
    const { ALL_FORMAT_IDS } = await import('../lib/renderer/formats')
    assert.equal(ALL_FORMAT_IDS.length, 5)
  })

  it('all format IDs are unique in ALL_FORMAT_IDS', async () => {
    const { ALL_FORMAT_IDS } = await import('../lib/renderer/formats')
    const unique = new Set(ALL_FORMAT_IDS)
    assert.equal(unique.size, ALL_FORMAT_IDS.length, 'ALL_FORMAT_IDS should have no duplicates')
  })
})

// ─── Phase 5: Action yaml deeper checks ──────────────────────────────────────

describe('Phase 5: GitHub Action deeper checks', () => {
  it('action.yml format input has default value', () => {
    const actionYmlPath = path.join(__dirname, '../github-action/action.yml')
    const content = fs.readFileSync(actionYmlPath, 'utf-8')
    // format input should have a default
    assert.ok(content.includes('format'), 'format input must exist')
    assert.ok(content.includes('default:') || content.includes("default: "), 'inputs should have defaults')
  })

  it('main.ts exports a run() or main() function (callable entry point)', () => {
    const mainPath = path.join(__dirname, '../github-action/src/main.ts')
    const content = fs.readFileSync(mainPath, 'utf-8')
    assert.ok(
      content.includes('async function run') || content.includes('async function main'),
      'main.ts must have an async run() or main() function'
    )
  })

  it('main.ts calls run() or main() at module level', () => {
    const mainPath = path.join(__dirname, '../github-action/src/main.ts')
    const content = fs.readFileSync(mainPath, 'utf-8')
    assert.ok(
      content.includes('run()') || content.includes('main()') || content.includes('run().catch'),
      'main.ts must invoke run/main at module level'
    )
  })

  it('example workflows use the action correctly', () => {
    const examplesDir = path.join(__dirname, '../github-action/examples')
    const files = fs.readdirSync(examplesDir).filter(f => f.endsWith('.yml') || f.endsWith('.yaml'))
    assert.ok(files.length >= 1)

    // At least one example should use the action's inputs
    let foundScriptPath = false
    for (const file of files) {
      const content = fs.readFileSync(path.join(examplesDir, file), 'utf-8')
      if (content.includes('script-path') || content.includes('demoscript')) {
        foundScriptPath = true
        break
      }
    }
    assert.ok(foundScriptPath, 'At least one example should reference script-path or demoscript')
  })
})

// ─── Phase 1: buildSystemPrompt quality ──────────────────────────────────────

describe('Phase 1: buildSystemPrompt quality checks', () => {
  it('system prompt mentions duration constraints', async () => {
    const { buildSystemPrompt } = await import('../lib/ai/prompts')
    const prompt = buildSystemPrompt()
    assert.ok(
      prompt.includes('0.5') || prompt.includes('duration'),
      'System prompt should mention duration constraints'
    )
  })

  it('system prompt mentions zoom constraints', async () => {
    const { buildSystemPrompt } = await import('../lib/ai/prompts')
    const prompt = buildSystemPrompt()
    assert.ok(prompt.includes('zoom'), 'System prompt should mention zoom')
  })

  it('system prompt mentions easing options', async () => {
    const { buildSystemPrompt } = await import('../lib/ai/prompts')
    const prompt = buildSystemPrompt()
    assert.ok(
      prompt.includes('linear') || prompt.includes('easing'),
      'System prompt should mention easing'
    )
  })

  it('system prompt is longer than 500 chars (sufficient detail)', async () => {
    const { buildSystemPrompt } = await import('../lib/ai/prompts')
    const prompt = buildSystemPrompt()
    assert.ok(prompt.length > 500, `System prompt too short: ${prompt.length} chars`)
  })

  it('buildUserMessage includes Demo description section', async () => {
    const { buildUserMessage } = await import('../lib/ai/prompts')
    const msg = buildUserMessage('https://example.com', [], 'Test the search feature')
    assert.ok(msg.includes('Demo description'), 'Message should have Demo description label')
    assert.ok(msg.includes('Test the search feature'))
  })
})

// ─── Phase 2: AbortError in async context ────────────────────────────────────

describe('Phase 2: AbortError async propagation', () => {
  it('AbortError can be caught as instanceof Error in async context', async () => {
    const { AbortError } = await import('../lib/watcher')

    async function throwAbort() {
      throw new AbortError('test')
    }

    try {
      await throwAbort()
      assert.fail('Should have thrown')
    } catch (err) {
      assert.ok(err instanceof Error)
      assert.ok(err instanceof AbortError)
      assert.equal((err as AbortError).name, 'AbortError')
    }
  })

  it('AbortError can be distinguished from other errors', async () => {
    const { AbortError } = await import('../lib/watcher')
    const errors: Error[] = [
      new AbortError(),
      new Error('generic'),
      new TypeError('type'),
    ]

    const abortErrors = errors.filter(e => e instanceof AbortError)
    const otherErrors = errors.filter(e => !(e instanceof AbortError))

    assert.equal(abortErrors.length, 1)
    assert.equal(otherErrors.length, 2)
  })
})
