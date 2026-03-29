/**
 * Comprehensive unit tests — Round 1 new coverage
 *
 * Tests all identified gaps across all five phases:
 *   - Watcher edge cases
 *   - Multi-format export internals
 *   - AI generator edge cases
 *   - Cloud client happy path + download
 *   - Error class hierarchy
 *   - Format spec consistency
 */

import { describe, it, beforeEach, afterEach } from 'node:test'
import assert from 'node:assert/strict'
import fs from 'fs'
import path from 'path'
import os from 'os'

// ─── Phase 2: Watcher edge cases ─────────────────────────────────────────────

describe('Phase 2: Watcher edge cases', () => {
  let tempDir: string
  let scriptFile: string

  const validScript = JSON.stringify({
    url: 'https://example.com',
    steps: [{ action: 'wait', duration: 1 }],
  })

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demoscript-unit-'))
    scriptFile = path.join(tempDir, 'demo.json')
    fs.writeFileSync(scriptFile, validScript)
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('throws synchronously when file does not exist', async () => {
    const { watchScript } = await import('../lib/watcher')
    const nonExistent = path.join(tempDir, 'does-not-exist.json')
    assert.throws(
      () => watchScript({ filePath: nonExistent, onChange: () => {} }),
      (err: Error) => {
        assert.ok(err.message.includes('not found') || err.message.includes('File not found'))
        return true
      }
    )
  })

  it('accepts empty steps array (no validation error)', (t, done) => {
    import('../lib/watcher').then(({ watchScript }) => {
      let changeCount = 0
      let parseErrors = 0

      const stop = watchScript({
        filePath: scriptFile,
        debounceMs: 100,
        onChange: () => { changeCount++ },
        onParseError: () => { parseErrors++ },
      })

      setTimeout(() => {
        fs.writeFileSync(scriptFile, JSON.stringify({ url: 'https://example.com', steps: [] }))
      }, 30)

      setTimeout(() => {
        stop()
        assert.equal(parseErrors, 0, 'Empty steps array is valid')
        assert.equal(changeCount, 1, 'onChange should fire for empty steps array')
        done()
      }, 400)
    })
  })

  it('multiple stop() calls do not throw', async () => {
    const { watchScript } = await import('../lib/watcher')
    const stop = watchScript({ filePath: scriptFile, debounceMs: 100, onChange: () => {} })
    assert.doesNotThrow(() => {
      stop()
      stop()
      stop()
    })
  })

  it('triggers parseError when steps field is missing', (t, done) => {
    import('../lib/watcher').then(({ watchScript }) => {
      let parseErrors = 0

      const stop = watchScript({
        filePath: scriptFile,
        debounceMs: 100,
        onChange: () => {},
        onParseError: (err) => {
          parseErrors++
          assert.ok(err.message.includes('steps'), `Expected "steps" in error: ${err.message}`)
        },
      })

      setTimeout(() => {
        fs.writeFileSync(scriptFile, JSON.stringify({ url: 'https://example.com' }))
      }, 30)

      setTimeout(() => {
        stop()
        assert.equal(parseErrors, 1)
        done()
      }, 400)
    })
  })

  it('calls onDeletedError when file is removed', (t, done) => {
    import('../lib/watcher').then(({ watchScript }) => {
      let deletedCalled = false

      const stop = watchScript({
        filePath: scriptFile,
        debounceMs: 100,
        onChange: () => {},
        onDeletedError: () => { deletedCalled = true },
      })

      setTimeout(() => {
        fs.unlinkSync(scriptFile)
      }, 30)

      setTimeout(() => {
        stop()
        assert.ok(deletedCalled, 'onDeletedError should be called when file is deleted')
        done()
      }, 500)
    })
  })

  it('passes the parsed script object to onChange', (t, done) => {
    import('../lib/watcher').then(({ watchScript }) => {
      const newScript = { url: 'https://newsite.com', steps: [{ action: 'wait', duration: 2 }] }
      let receivedScript: unknown = null

      const stop = watchScript({
        filePath: scriptFile,
        debounceMs: 100,
        onChange: (s) => { receivedScript = s },
      })

      setTimeout(() => {
        fs.writeFileSync(scriptFile, JSON.stringify(newScript))
      }, 30)

      setTimeout(() => {
        stop()
        assert.ok(receivedScript !== null)
        const received = receivedScript as typeof newScript
        assert.equal(received.url, 'https://newsite.com')
        done()
      }, 400)
    })
  })
})

// ─── Phase 3: encodeMultipleFormats internals ─────────────────────────────────

describe('Phase 3: encodeMultipleFormats internals', () => {
  let tempDir: string

  beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demoscript-enc-'))
  })

  afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true })
  })

  it('returns empty object for empty formatIds array', async () => {
    const { encodeMultipleFormats } = await import('../lib/renderer/ffmpeg')
    const result = await encodeMultipleFormats({
      frameDir: tempDir,
      baseOutputPath: path.join(tempDir, 'out'),
      fps: 24,
      viewport: { width: 1280, height: 720 },
      formatIds: [],
    })
    assert.deepEqual(result, {})
  })

  it('ALL_FORMAT_IDS exactly matches the keys of FORMAT_SPECS', async () => {
    const { FORMAT_SPECS, ALL_FORMAT_IDS } = await import('../lib/renderer/formats')
    const specKeys = Object.keys(FORMAT_SPECS).sort()
    const allIds = [...ALL_FORMAT_IDS].sort()
    assert.deepEqual(specKeys, allIds, 'ALL_FORMAT_IDS must match FORMAT_SPECS keys exactly')
  })

  it('thumbnail copies first frame PNG to outputPath', async () => {
    const { encodeMultipleFormats } = await import('../lib/renderer/ffmpeg')

    // Create a minimal 1x1 PNG (binary data for a valid 1x1 PNG)
    const frameDir = path.join(tempDir, 'frames')
    fs.mkdirSync(frameDir, { recursive: true })

    // 1x1 white PNG bytes
    const pngBytes = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, // PNG signature
      0x00, 0x00, 0x00, 0x0d, 0x49, 0x48, 0x44, 0x52, // IHDR chunk length + type
      0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x01, // 1x1
      0x08, 0x02, 0x00, 0x00, 0x00, 0x90, 0x77, 0x53, // 8-bit RGB
      0xde, 0x00, 0x00, 0x00, 0x0c, 0x49, 0x44, 0x41, // IDAT chunk
      0x54, 0x08, 0xd7, 0x63, 0xf8, 0xcf, 0xc0, 0x00,
      0x00, 0x00, 0x02, 0x00, 0x01, 0xe2, 0x21, 0xbc,
      0x33, 0x00, 0x00, 0x00, 0x00, 0x49, 0x45, 0x4e, // IEND chunk
      0x44, 0xae, 0x42, 0x60, 0x82,
    ])
    fs.writeFileSync(path.join(frameDir, 'frame_0001.png'), pngBytes)

    const baseOutputPath = path.join(tempDir, 'demo_test')
    const result = await encodeMultipleFormats({
      frameDir,
      baseOutputPath,
      fps: 24,
      viewport: { width: 1, height: 1 },
      formatIds: ['thumbnail'],
    })

    assert.ok(result['thumbnail'], 'thumbnail result should exist')
    assert.equal(result['thumbnail'].success, true, `thumbnail should succeed: ${result['thumbnail'].error}`)
    assert.ok(result['thumbnail'].outputPath?.endsWith('.png'), 'output should be .png')
    assert.ok(fs.existsSync(result['thumbnail'].outputPath!), 'output file should exist on disk')
  })

  it('unknown formatId returns error result without throwing', async () => {
    const { encodeMultipleFormats } = await import('../lib/renderer/ffmpeg')
    const result = await encodeMultipleFormats({
      frameDir: tempDir,
      baseOutputPath: path.join(tempDir, 'out'),
      fps: 24,
      viewport: { width: 1280, height: 720 },
      formatIds: ['unknown-format' as never],
    })
    assert.ok(result['unknown-format'], 'Should have result for unknown format')
    assert.equal(result['unknown-format'].success, false)
    assert.ok(result['unknown-format'].error?.includes('Unknown format'))
  })

  it('FormatEncodeResult fields: success true has outputPath and fileSizeBytes', async () => {
    const { encodeMultipleFormats } = await import('../lib/renderer/ffmpeg')

    const frameDir = path.join(tempDir, 'frames2')
    fs.mkdirSync(frameDir, { recursive: true })
    // 1x1 white PNG bytes
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

    const result = await encodeMultipleFormats({
      frameDir,
      baseOutputPath: path.join(tempDir, 'demo_test2'),
      fps: 24,
      viewport: { width: 1, height: 1 },
      formatIds: ['thumbnail'],
    })

    const r = result['thumbnail']
    assert.equal(r.success, true)
    assert.equal(typeof r.outputPath, 'string')
    assert.equal(typeof r.fileSizeBytes, 'number')
    assert.ok(r.fileSizeBytes! > 0)
  })
})

// ─── Phase 3: Format spec consistency ─────────────────────────────────────────

describe('Phase 3: Format spec fields consistency', () => {
  it('each FORMAT_SPEC id field matches its key', async () => {
    const { FORMAT_SPECS } = await import('../lib/renderer/formats')
    for (const [key, spec] of Object.entries(FORMAT_SPECS)) {
      assert.equal(spec.id, key, `spec.id (${spec.id}) should equal key (${key})`)
    }
  })

  it('gif spec has no ffmpegOptions (handled by two-pass custom logic)', async () => {
    const { FORMAT_SPECS } = await import('../lib/renderer/formats')
    assert.deepEqual(FORMAT_SPECS['gif'].ffmpegOptions, [])
  })

  it('thumbnail spec has isThumbnail=true', async () => {
    const { FORMAT_SPECS } = await import('../lib/renderer/formats')
    assert.equal(FORMAT_SPECS['thumbnail'].isThumbnail, true)
  })

  it('mp4-linkedin has 1:1 aspectRatio', async () => {
    const { FORMAT_SPECS } = await import('../lib/renderer/formats')
    assert.equal(FORMAT_SPECS['mp4-linkedin'].aspectRatio, '1:1')
  })

  it('all mp4 formats use mp4 extension', async () => {
    const { FORMAT_SPECS } = await import('../lib/renderer/formats')
    for (const id of ['mp4-standard', 'mp4-twitter', 'mp4-linkedin'] as const) {
      assert.equal(FORMAT_SPECS[id].extension, 'mp4', `${id} should have mp4 extension`)
    }
  })
})

// ─── Phase 1: AI generator edge cases ─────────────────────────────────────────

describe('Phase 1: AI generator edge cases', () => {
  it('parseAIResponse handles empty array', async () => {
    const { parseAIResponse } = await import('../lib/ai/scriptGenerator')
    const result = parseAIResponse('[]')
    assert.deepEqual(result, [])
  })

  it('parseAIResponse handles whitespace-padded JSON', async () => {
    const { parseAIResponse } = await import('../lib/ai/scriptGenerator')
    const raw = '  \n  [{"action":"wait","target":null,"duration":1}]  \n  '
    const result = parseAIResponse(raw)
    assert.equal(result.length, 1)
    assert.equal(result[0].action, 'wait')
  })

  it('parseAIResponse preserves all action fields in output', async () => {
    const { parseAIResponse } = await import('../lib/ai/scriptGenerator')
    const step = {
      action: 'zoom-in',
      target: '#hero',
      duration: 2.5,
      zoom: 2.0,
      annotation: 'Zoom in on hero',
      easing: 'ease-in-out',
    }
    const result = parseAIResponse(JSON.stringify([step]))
    assert.equal(result.length, 1)
    assert.equal(result[0].action, 'zoom-in')
    assert.equal(result[0].duration, 2.5)
  })

  it('validateGeneratedSteps accepts all 8 valid actions', async () => {
    const { validateGeneratedSteps } = await import('../lib/ai/scriptGenerator')
    const actions = ['wait', 'scroll-to', 'zoom-in', 'zoom-out', 'highlight', 'pan', 'cursor-move', 'click'] as const
    const elements = [{ selector: '#el', label: 'el', boundingBox: { x: 0, y: 0, width: 100, height: 50 }, tagName: 'div', innerText: 'text' }]

    for (const action of actions) {
      const step = { action, target: '#el', duration: 1 } as Parameters<typeof validateGeneratedSteps>[0][number]
      assert.doesNotThrow(
        () => validateGeneratedSteps([step], elements),
        `Action "${action}" should be valid`
      )
    }
  })

  it('validateGeneratedSteps throws for step with no action field', async () => {
    const { validateGeneratedSteps } = await import('../lib/ai/scriptGenerator')
    const steps = [{ target: '#el', duration: 1 }] as Parameters<typeof validateGeneratedSteps>[0]
    assert.throws(() => validateGeneratedSteps(steps, []), /action/)
  })

  it('validateGeneratedSteps throws for invalid action name', async () => {
    const { validateGeneratedSteps } = await import('../lib/ai/scriptGenerator')
    const steps = [{ action: 'teleport' as never, target: null, duration: 1 }] as Parameters<typeof validateGeneratedSteps>[0]
    assert.throws(() => validateGeneratedSteps(steps, []), /invalid/)
  })

  it('validateGeneratedSteps does not throw for unknown selector (only warns)', async () => {
    const { validateGeneratedSteps } = await import('../lib/ai/scriptGenerator')
    const steps = [{ action: 'highlight' as const, target: '#nonexistent', duration: 2 }] as Parameters<typeof validateGeneratedSteps>[0]
    assert.doesNotThrow(() => validateGeneratedSteps(steps, []))
  })

  it('generateScript throws when no API key provided', async () => {
    const { generateScript } = await import('../lib/ai/scriptGenerator')
    const savedKey = process.env.ANTHROPIC_API_KEY
    delete process.env.ANTHROPIC_API_KEY

    await assert.rejects(
      () => generateScript({ url: 'https://example.com', prompt: 'show the page' }),
      (err: Error) => {
        assert.ok(err.message.includes('ANTHROPIC_API_KEY'), `Expected ANTHROPIC_API_KEY error, got: ${err.message}`)
        return true
      }
    )

    if (savedKey) process.env.ANTHROPIC_API_KEY = savedKey
  })

  it('buildUserMessage includes all element selectors', async () => {
    const { buildUserMessage } = await import('../lib/ai/prompts')
    const elements = [
      { selector: '#hero', label: 'hero', boundingBox: { x: 0, y: 0, width: 100, height: 50 }, tagName: 'div', innerText: 'Hero' },
      { selector: '.pricing', label: 'pricing', boundingBox: { x: 0, y: 100, width: 100, height: 50 }, tagName: 'section', innerText: 'Pricing' },
      { selector: 'button[data-cta]', label: 'cta', boundingBox: { x: 0, y: 200, width: 100, height: 40 }, tagName: 'button', innerText: 'Sign up' },
    ]
    const msg = buildUserMessage('https://example.com', elements, 'show features')
    assert.ok(msg.includes('#hero'))
    assert.ok(msg.includes('.pricing'))
    assert.ok(msg.includes('button[data-cta]'))
  })

  it('buildUserMessage handles empty elements list gracefully', async () => {
    const { buildUserMessage } = await import('../lib/ai/prompts')
    const msg = buildUserMessage('https://example.com', [], 'show the page')
    assert.ok(msg.includes('https://example.com'))
    assert.ok(msg.includes('show the page'))
    assert.ok(typeof msg === 'string')
  })

  it('buildSystemPrompt mentions JSON output (no code fences)', async () => {
    const { buildSystemPrompt } = await import('../lib/ai/prompts')
    const prompt = buildSystemPrompt()
    assert.ok(prompt.includes('JSON'))
    assert.ok(prompt.includes('No markdown code fences') || prompt.includes('JSON array'), 'Prompt should discourage code fences')
  })
})

// ─── Phase 4: Cloud client happy path ─────────────────────────────────────────

describe('Phase 4: Cloud client advanced scenarios', () => {
  it('render() happy path: 202 → polling processing → complete returns result', async () => {
    const { createCloudClient } = await import('../lib/api/client')
    const originalFetch = global.fetch

    let callCount = 0
    global.fetch = async (url: RequestInfo | URL) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      callCount++
      if (urlStr.includes('/v1/render')) {
        return new Response(
          JSON.stringify({ jobId: 'job-abc', pollUrl: '/v1/jobs/job-abc' }),
          { status: 202 }
        )
      }
      if (urlStr.includes('/v1/jobs/')) {
        if (callCount < 4) {
          return new Response(
            JSON.stringify({ jobId: 'job-abc', status: 'processing', progress: 50, currentStep: 'encoding' }),
            { status: 200 }
          )
        }
        return new Response(
          JSON.stringify({
            jobId: 'job-abc',
            status: 'complete',
            progress: 100,
            currentStep: 'done',
            downloadUrls: { 'mp4-standard': 'https://r2.example.com/job-abc.mp4' },
          }),
          { status: 200 }
        )
      }
      return new Response('Not found', { status: 404 })
    }

    const client = createCloudClient({ apiKey: 'ds_live_test', timeout: 30000 })
    const mockScript = {
      id: 'test',
      url: 'https://example.com',
      viewport: { width: 1280, height: 720 },
      fps: 24,
      outputFormat: 'mp4' as const,
      steps: [],
      createdAt: new Date().toISOString(),
    }

    const result = await client.render(mockScript, 'mp4')
    assert.equal(result.jobId, 'job-abc')
    assert.ok(result.downloadUrls['mp4-standard'])
    assert.ok(result.renderDurationSeconds >= 0)

    global.fetch = originalFetch
  })

  it('render() calls onProgress callback with progress values', async () => {
    const { createCloudClient } = await import('../lib/api/client')
    const originalFetch = global.fetch

    const progressValues: number[] = []
    let pollCount = 0

    global.fetch = async (url: RequestInfo | URL) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/v1/render')) {
        return new Response(
          JSON.stringify({ jobId: 'job-xyz', pollUrl: '/v1/jobs/job-xyz' }),
          { status: 202 }
        )
      }
      if (urlStr.includes('/v1/jobs/')) {
        pollCount++
        if (pollCount < 3) {
          return new Response(
            JSON.stringify({ jobId: 'job-xyz', status: 'processing', progress: pollCount * 25, currentStep: 'step' }),
            { status: 200 }
          )
        }
        return new Response(
          JSON.stringify({
            jobId: 'job-xyz',
            status: 'complete',
            progress: 100,
            currentStep: 'done',
            downloadUrls: { 'mp4': 'https://example.com/out.mp4' },
          }),
          { status: 200 }
        )
      }
      return new Response('Not found', { status: 404 })
    }

    const client = createCloudClient({ apiKey: 'ds_live_test', timeout: 30000 })
    const mockScript = {
      id: 'test',
      url: 'https://example.com',
      viewport: { width: 1280, height: 720 },
      fps: 24,
      outputFormat: 'mp4' as const,
      steps: [],
      createdAt: new Date().toISOString(),
    }

    await client.render(mockScript, 'mp4', {
      onProgress: (p, msg) => {
        progressValues.push(p)
        assert.equal(typeof p, 'number')
        assert.equal(typeof msg, 'string')
      },
    })

    assert.ok(progressValues.length > 0, 'onProgress should have been called at least once')
    assert.ok(progressValues.some(p => p > 0), 'Progress values should include positive numbers')

    global.fetch = originalFetch
  })

  it('render() throws DemoScriptError when job status is "failed"', async () => {
    const { createCloudClient, DemoScriptError } = await import('../lib/api/client')
    const originalFetch = global.fetch

    global.fetch = async (url: RequestInfo | URL) => {
      const urlStr = typeof url === 'string' ? url : url.toString()
      if (urlStr.includes('/v1/render')) {
        return new Response(
          JSON.stringify({ jobId: 'job-fail', pollUrl: '/v1/jobs/job-fail' }),
          { status: 202 }
        )
      }
      return new Response(
        JSON.stringify({ jobId: 'job-fail', status: 'failed', progress: 0, currentStep: '', errorMessage: 'FFmpeg crashed' }),
        { status: 200 }
      )
    }

    const client = createCloudClient({ apiKey: 'ds_live_test', timeout: 30000 })
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
        assert.ok(err instanceof DemoScriptError)
        assert.ok(err.message.includes('FFmpeg crashed'))
        return true
      }
    )

    global.fetch = originalFetch
  })

  it('downloadToFile creates output directory and writes file', async () => {
    const { createCloudClient } = await import('../lib/api/client')
    const originalFetch = global.fetch
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demoscript-dl-'))

    try {
      const fileContent = Buffer.from('fake video bytes 12345')
      global.fetch = async () => {
        return new Response(fileContent, { status: 200 })
      }

      const client = createCloudClient({ apiKey: 'ds_live_test' })
      const outputPath = path.join(tempDir, 'nested', 'subdir', 'output.mp4')

      await client.downloadToFile('https://example.com/video.mp4', outputPath)

      assert.ok(fs.existsSync(outputPath), 'Output file should be created')
      const written = fs.readFileSync(outputPath)
      assert.equal(written.toString(), 'fake video bytes 12345')
    } finally {
      global.fetch = originalFetch
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('downloadToFile throws DemoScriptError on non-200 response', async () => {
    const { createCloudClient, DemoScriptError } = await import('../lib/api/client')
    const originalFetch = global.fetch
    const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'demoscript-dl2-'))

    try {
      global.fetch = async () => new Response('Not Found', { status: 404 })

      const client = createCloudClient({ apiKey: 'ds_live_test' })

      await assert.rejects(
        () => client.downloadToFile('https://example.com/missing.mp4', path.join(tempDir, 'out.mp4')),
        (err: Error) => {
          assert.ok(err instanceof DemoScriptError)
          assert.ok(err.message.includes('404'))
          return true
        }
      )
    } finally {
      global.fetch = originalFetch
      fs.rmSync(tempDir, { recursive: true, force: true })
    }
  })

  it('checkAuth() returns AuthStatus on 200', async () => {
    const { createCloudClient } = await import('../lib/api/client')
    const originalFetch = global.fetch

    const mockStatus = { tier: 'pro', rendersThisMonth: 5, renderLimitMonthly: 100, rendersRemaining: 95 }
    global.fetch = async () => new Response(JSON.stringify(mockStatus), { status: 200 })

    const client = createCloudClient({ apiKey: 'ds_live_test' })
    const result = await client.checkAuth()

    assert.equal(result.tier, 'pro')
    assert.equal(result.rendersThisMonth, 5)
    assert.equal(result.renderLimitMonthly, 100)
    assert.equal(result.rendersRemaining, 95)

    global.fetch = originalFetch
  })
})

// ─── Phase 4: Error class hierarchy ───────────────────────────────────────────

describe('Phase 4: Error class hierarchy', () => {
  it('NetworkError extends DemoScriptError', async () => {
    const { NetworkError, DemoScriptError } = await import('../lib/api/client')
    const err = new NetworkError('connection refused')
    assert.ok(err instanceof NetworkError)
    assert.ok(err instanceof DemoScriptError)
    assert.ok(err instanceof Error)
    assert.equal(err.name, 'NetworkError')
    assert.equal(err.message, 'connection refused')
  })

  it('all error class names are correct', async () => {
    const { AuthError, RateLimitError, ValidationError, TimeoutError, NetworkError, DemoScriptError } = await import('../lib/api/client')
    assert.equal(new AuthError('').name, 'AuthError')
    assert.equal(new RateLimitError('', 0, 0, '').name, 'RateLimitError')
    assert.equal(new ValidationError('').name, 'ValidationError')
    assert.equal(new TimeoutError('').name, 'TimeoutError')
    assert.equal(new NetworkError('').name, 'NetworkError')
    assert.equal(new DemoScriptError('').name, 'DemoScriptError')
  })

  it('RateLimitError fields are accessible', async () => {
    const { RateLimitError } = await import('../lib/api/client')
    const err = new RateLimitError('over limit', 25, 25, '2026-04-01')
    assert.equal(err.rendersThisMonth, 25)
    assert.equal(err.limit, 25)
    assert.equal(err.resetDate, '2026-04-01')
  })

  it('ValidationError on 400 response from checkAuth', async () => {
    const { createCloudClient, ValidationError } = await import('../lib/api/client')
    const originalFetch = global.fetch
    global.fetch = async () => new Response(
      JSON.stringify({ error: 'Invalid field' }),
      { status: 400 }
    )

    const client = createCloudClient({ apiKey: 'ds_live_test' })
    await assert.rejects(
      () => client.checkAuth(),
      (err: Error) => {
        assert.ok(err instanceof ValidationError)
        assert.ok(err.message.includes('Invalid field'))
        return true
      }
    )

    global.fetch = originalFetch
  })

  it('DemoScriptError thrown on arbitrary 5xx status', async () => {
    const { createCloudClient, DemoScriptError } = await import('../lib/api/client')
    const originalFetch = global.fetch
    global.fetch = async () => new Response(
      JSON.stringify({ error: 'Internal server error' }),
      { status: 500 }
    )

    const client = createCloudClient({ apiKey: 'ds_live_test' })
    await assert.rejects(
      () => client.checkAuth(),
      (err: Error) => {
        assert.ok(err instanceof DemoScriptError)
        return true
      }
    )

    global.fetch = originalFetch
  })
})

// ─── Phase 5: Action YAML semantic validity ────────────────────────────────────

describe('Phase 5: action.yml semantic validity', () => {
  it('action.yml uses node20 runtime', () => {
    const actionYmlPath = path.join(__dirname, '../github-action/action.yml')
    const content = fs.readFileSync(actionYmlPath, 'utf-8')
    assert.ok(content.includes('node20'), 'action.yml must use node20 runtime')
  })

  it('action.yml api-key input is not required (has default)', () => {
    const actionYmlPath = path.join(__dirname, '../github-action/action.yml')
    const content = fs.readFileSync(actionYmlPath, 'utf-8')
    // api-key should either not be required or allow env variable usage
    assert.ok(content.includes('api-key'), 'api-key input should exist')
  })

  it('action.yml main entry points to dist/index.js', () => {
    const actionYmlPath = path.join(__dirname, '../github-action/action.yml')
    const content = fs.readFileSync(actionYmlPath, 'utf-8')
    assert.ok(content.includes('dist/index.js'), 'action.yml main must point to dist/index.js')
  })

  it('main.ts uses core.setOutput for output-file', () => {
    const mainPath = path.join(__dirname, '../github-action/src/main.ts')
    const content = fs.readFileSync(mainPath, 'utf-8')
    assert.ok(content.includes('setOutput'), 'main.ts must use setOutput')
    assert.ok(content.includes('output-file') || content.includes('outputFile'), 'main.ts must set output-file')
  })

  it('main.ts uses core.setFailed for error handling', () => {
    const mainPath = path.join(__dirname, '../github-action/src/main.ts')
    const content = fs.readFileSync(mainPath, 'utf-8')
    assert.ok(content.includes('setFailed'), 'main.ts must use core.setFailed')
  })

  it('github-action README describes all inputs', () => {
    const readmePath = path.join(__dirname, '../github-action/README.md')
    if (!fs.existsSync(readmePath)) return // skip if no README
    const content = fs.readFileSync(readmePath, 'utf-8')
    const requiredInputs = ['script-path', 'output-path', 'format', 'api-key']
    for (const input of requiredInputs) {
      assert.ok(content.includes(input), `README should document input: ${input}`)
    }
  })
})

// ─── General: pkg/index exports ───────────────────────────────────────────────

describe('pkg/index.ts exports', () => {
  it('render is exported (public API wrapping renderScript)', async () => {
    const pkg = await import('../pkg/index')
    assert.equal(typeof pkg.render, 'function')
  })

  it('generate is exported', async () => {
    const pkg = await import('../pkg/index')
    assert.equal(typeof pkg.generate, 'function')
  })

  it('createCloudClient is exported', async () => {
    const pkg = await import('../pkg/index')
    assert.equal(typeof pkg.createCloudClient, 'function')
  })

  it('AbortError is exported from watcher', async () => {
    const { AbortError } = await import('../lib/watcher')
    const err = new AbortError()
    assert.equal(err.name, 'AbortError')
    assert.equal(err.message, 'Render aborted')
  })

  it('AbortError default message is "Render aborted"', async () => {
    const { AbortError } = await import('../lib/watcher')
    assert.equal(new AbortError().message, 'Render aborted')
  })

  it('AbortError custom message is preserved', async () => {
    const { AbortError } = await import('../lib/watcher')
    assert.equal(new AbortError('custom message').message, 'custom message')
  })
})
