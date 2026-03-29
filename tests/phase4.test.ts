import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { createCloudClient, AuthError, RateLimitError, ValidationError, TimeoutError, DemoScriptError } from '../lib/api/client'

// ─── Cloud API Client Tests ────────────────────────────────────────────────────

describe('Phase 4: Hosted Render API', () => {
  describe('createCloudClient()', () => {
    it('creates a DemoScriptCloudClient instance', () => {
      const client = createCloudClient({ apiKey: 'ds_live_test123' })
      assert.ok(client, 'Client should be created')
      assert.equal(typeof client.checkAuth, 'function')
      assert.equal(typeof client.render, 'function')
      assert.equal(typeof client.downloadToFile, 'function')
    })

    it('accepts custom baseUrl and timeout', () => {
      const client = createCloudClient({
        apiKey: 'ds_live_test',
        baseUrl: 'http://localhost:3001',
        timeout: 5000,
      })
      assert.ok(client)
    })
  })

  describe('Error classes', () => {
    it('AuthError extends DemoScriptError', () => {
      const err = new AuthError('bad key')
      assert.ok(err instanceof AuthError)
      assert.ok(err instanceof DemoScriptError)
      assert.ok(err instanceof Error)
      assert.equal(err.name, 'AuthError')
    })

    it('RateLimitError has rendersThisMonth, limit, resetDate', () => {
      const err = new RateLimitError('limit reached', 10, 10, '2025-02-01')
      assert.equal(err.rendersThisMonth, 10)
      assert.equal(err.limit, 10)
      assert.equal(err.resetDate, '2025-02-01')
      assert.ok(err instanceof DemoScriptError)
    })

    it('ValidationError extends DemoScriptError', () => {
      const err = new ValidationError('bad field')
      assert.ok(err instanceof ValidationError)
      assert.ok(err instanceof DemoScriptError)
      assert.equal(err.name, 'ValidationError')
    })

    it('TimeoutError extends DemoScriptError', () => {
      const err = new TimeoutError('timed out')
      assert.ok(err instanceof TimeoutError)
      assert.ok(err instanceof DemoScriptError)
      assert.equal(err.name, 'TimeoutError')
    })

    it('all error classes have correct names', () => {
      assert.equal(new AuthError('').name, 'AuthError')
      assert.equal(new RateLimitError('', 0, 0, '').name, 'RateLimitError')
      assert.equal(new ValidationError('').name, 'ValidationError')
      assert.equal(new TimeoutError('').name, 'TimeoutError')
      assert.equal(new DemoScriptError('').name, 'DemoScriptError')
    })
  })

  describe('Client authentication handling', () => {
    it('client.checkAuth() throws AuthError on 401 response', async () => {
      // We mock the fetch to simulate a 401 response
      const originalFetch = global.fetch
      global.fetch = async () => new Response(JSON.stringify({ error: 'Invalid API key' }), { status: 401 })

      const client = createCloudClient({ apiKey: 'bad-key' })
      await assert.rejects(
        () => client.checkAuth(),
        (err: Error) => {
          assert.ok(err instanceof AuthError, `Expected AuthError, got ${err.constructor.name}`)
          return true
        }
      )

      global.fetch = originalFetch
    })

    it('client.render() throws RateLimitError on 429 response', async () => {
      const originalFetch = global.fetch
      global.fetch = async () => new Response(
        JSON.stringify({ error: 'limit reached', rendersThisMonth: 10, limit: 10, resetDate: '2025-02-01' }),
        { status: 429 }
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
          assert.ok(err instanceof RateLimitError, `Expected RateLimitError, got ${err.constructor.name}`)
          return true
        }
      )

      global.fetch = originalFetch
    })

    it('client.render() respects timeout option', async () => {
      const originalFetch = global.fetch
      // Simulate a long-running job that never completes within the timeout
      let callCount = 0
      global.fetch = async (url: RequestInfo | URL) => {
        const urlStr = url.toString()
        if (urlStr.includes('/v1/render')) {
          return new Response(
            JSON.stringify({ jobId: 'test-job-id', pollUrl: '/v1/jobs/test-job-id' }),
            { status: 202 }
          )
        }
        // Poll always returns 'processing'
        callCount++
        return new Response(
          JSON.stringify({ jobId: 'test-job-id', status: 'processing', progress: 10, currentStep: 'rendering' }),
          { status: 200 }
        )
      }

      const client = createCloudClient({ apiKey: 'ds_live_test', timeout: 100 })
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
          assert.ok(err instanceof TimeoutError, `Expected TimeoutError, got ${err.constructor.name}: ${err.message}`)
          return true
        }
      )

      global.fetch = originalFetch
    })
  })

  describe('Server-side components exist', () => {
    it('server/src/app.ts exists', async () => {
      const fs = await import('fs')
      const path = await import('path')
      const appPath = path.join(__dirname, '../server/src/app.ts')
      assert.ok(fs.existsSync(appPath), 'server/src/app.ts must exist')
    })

    it('server/src/db/schema.ts has table definitions', async () => {
      const fs = await import('fs')
      const path = await import('path')
      const schemaPath = path.join(__dirname, '../server/src/db/schema.ts')
      assert.ok(fs.existsSync(schemaPath))
      const content = fs.readFileSync(schemaPath, 'utf-8')
      assert.ok(content.includes('api_keys'), 'Schema must define api_keys table')
      assert.ok(content.includes('render_jobs'), 'Schema must define render_jobs table')
    })

    it('server auth middleware validates Bearer token format', async () => {
      const fs = await import('fs')
      const path = await import('path')
      const authPath = path.join(__dirname, '../server/src/middleware/auth.ts')
      assert.ok(fs.existsSync(authPath))
      const content = fs.readFileSync(authPath, 'utf-8')
      assert.ok(content.includes('Bearer'), 'Auth middleware must check Bearer token')
      assert.ok(content.includes('sha256') || content.includes('SHA-256') || content.includes('createHash'), 'Must hash the key')
    })

    it('API key generation uses ds_live_ prefix', async () => {
      const fs = await import('fs')
      const path = await import('path')
      const authRoutePath = path.join(__dirname, '../server/src/routes/auth.ts')
      assert.ok(fs.existsSync(authRoutePath))
      const content = fs.readFileSync(authRoutePath, 'utf-8')
      assert.ok(content.includes('ds_live_'), 'Key generation must use ds_live_ prefix')
    })
  })
})
