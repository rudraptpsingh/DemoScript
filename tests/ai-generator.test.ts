import { describe, it } from 'node:test'
import assert from 'node:assert/strict'
import { buildSystemPrompt, buildUserMessage } from '../lib/ai/prompts'
import { parseAIResponse, validateGeneratedSteps } from '../lib/ai/scriptGenerator'
import type { CapturedElement } from '../lib/types'

// ─── AI Script Generator Tests ─────────────────────────────────────────────────

describe('Phase 1: AI Script Generator', () => {
  describe('buildSystemPrompt()', () => {
    it('returns a string containing all eight action names', () => {
      const prompt = buildSystemPrompt()
      assert.equal(typeof prompt, 'string')
      const actions = ['wait', 'scroll-to', 'zoom-in', 'zoom-out', 'highlight', 'pan', 'cursor-move', 'click']
      for (const action of actions) {
        assert.ok(prompt.includes(action), `System prompt must include action: ${action}`)
      }
    })

    it('contains output format instructions', () => {
      const prompt = buildSystemPrompt()
      assert.ok(prompt.includes('JSON'), 'Must include JSON output instructions')
      assert.ok(prompt.includes('array'), 'Must reference array output format')
    })

    it('contains quality guidelines', () => {
      const prompt = buildSystemPrompt()
      assert.ok(prompt.includes('annotation'), 'Should mention annotation usage')
    })
  })

  describe('buildUserMessage()', () => {
    it('includes URL, elements table, and prompt', () => {
      const elements: CapturedElement[] = [
        {
          selector: '#hero',
          label: 'hero',
          boundingBox: { x: 0, y: 0, width: 1280, height: 600 },
          tagName: 'div',
          innerText: 'Welcome to our product',
        },
      ]
      const msg = buildUserMessage('https://example.com', elements, 'Show the hero section')
      assert.ok(msg.includes('https://example.com'), 'Message must include URL')
      assert.ok(msg.includes('#hero'), 'Message must include element selector')
      assert.ok(msg.includes('Show the hero section'), 'Message must include user prompt')
    })
  })

  describe('parseAIResponse()', () => {
    it('parses valid JSON array', () => {
      const raw = JSON.stringify([
        { action: 'wait', target: null, duration: 1.5, annotation: 'Welcome' },
        { action: 'scroll-to', target: '#pricing', duration: 2.0 },
      ])
      const result = parseAIResponse(raw)
      assert.equal(result.length, 2)
      assert.equal(result[0].action, 'wait')
      assert.equal(result[1].action, 'scroll-to')
    })

    it('strips markdown code fences and parses correctly', () => {
      const raw = '```json\n[{"action":"wait","target":null,"duration":1}]\n```'
      const result = parseAIResponse(raw)
      assert.equal(result.length, 1)
      assert.equal(result[0].action, 'wait')
    })

    it('strips plain code fences without language tag', () => {
      const raw = '```\n[{"action":"highlight","target":"h1","duration":2}]\n```'
      const result = parseAIResponse(raw)
      assert.equal(result.length, 1)
      assert.equal(result[0].action, 'highlight')
    })

    it('throws error with raw response when JSON is invalid', () => {
      const raw = 'this is not json at all'
      assert.throws(
        () => parseAIResponse(raw),
        (err: Error) => {
          assert.ok(err.message.includes('invalid JSON') || err.message.includes('Raw response'))
          return true
        }
      )
    })

    it('throws error when response is not an array', () => {
      const raw = JSON.stringify({ action: 'wait' })
      assert.throws(
        () => parseAIResponse(raw),
        (err: Error) => {
          assert.ok(err.message.includes('not an array'))
          return true
        }
      )
    })
  })

  describe('validateGeneratedSteps()', () => {
    const elements: CapturedElement[] = [
      {
        selector: '#hero',
        label: 'hero',
        boundingBox: { x: 0, y: 0, width: 1280, height: 600 },
        tagName: 'div',
        innerText: 'Hero section',
      },
    ]

    it('passes for valid steps with known selectors', () => {
      const steps = [{ action: 'scroll-to' as const, target: '#hero', duration: 2 }]
      assert.doesNotThrow(() => validateGeneratedSteps(steps as Parameters<typeof validateGeneratedSteps>[0], elements))
    })

    it('throws when step is missing required action field', () => {
      const steps = [{ target: '#hero', duration: 2 }] as Parameters<typeof validateGeneratedSteps>[0]
      assert.throws(
        () => validateGeneratedSteps(steps, elements),
        (err: Error) => {
          assert.ok(err.message.includes('action'), `Error should mention "action": ${err.message}`)
          return true
        }
      )
    })

    it('logs warning (not throw) for selector not in captured elements', () => {
      const steps = [{ action: 'highlight' as const, target: '#nonexistent', duration: 2 }]
      // Should not throw — just warn
      assert.doesNotThrow(() =>
        validateGeneratedSteps(steps as Parameters<typeof validateGeneratedSteps>[0], elements)
      )
    })

    it('throws for invalid action name', () => {
      const steps = [{ action: 'fly-away' as unknown as 'wait', target: null, duration: 1 }]
      assert.throws(
        () => validateGeneratedSteps(steps as Parameters<typeof validateGeneratedSteps>[0], elements),
        (err: Error) => {
          assert.ok(err.message.includes('action') || err.message.includes('invalid'))
          return true
        }
      )
    })
  })

  describe('generate() function export', () => {
    it('generate is exported from pkg/index.ts', async () => {
      const pkg = await import('../pkg/index')
      assert.equal(typeof pkg.generate, 'function', 'generate must be exported')
    })

    it('createCloudClient is exported from pkg/index.ts', async () => {
      const pkg = await import('../pkg/index')
      assert.equal(typeof pkg.createCloudClient, 'function', 'createCloudClient must be exported')
    })
  })
})
