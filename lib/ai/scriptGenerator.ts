import { Step, CapturedElement, ActionType } from '../types'
import { buildSystemPrompt, buildUserMessage } from './prompts'
import { nanoid } from 'nanoid'

export interface GenerateOptions {
  url: string
  prompt: string
  apiKey?: string
  capturedElements?: CapturedElement[]
  model?: string
}

export interface GenerateResult {
  steps: Step[]
  capturedElements: CapturedElement[]
  tokensUsed: number
  estimatedDuration: number
}

const VALID_ACTIONS: Set<ActionType> = new Set([
  'scroll-to',
  'zoom-in',
  'zoom-out',
  'highlight',
  'pan',
  'cursor-move',
  'wait',
  'click',
])

export function parseAIResponse(raw: string): Omit<Step, 'id' | 'order'>[] {
  // Strip any accidental markdown fences
  let text = raw.trim()
  text = text.replace(/^```(?:json)?\s*/i, '').replace(/\s*```\s*$/, '').trim()

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new Error(
      `AI returned invalid JSON: ${err instanceof Error ? err.message : err}\n\nRaw response:\n${raw}`
    )
  }

  if (!Array.isArray(parsed)) {
    throw new Error(`AI response is not an array. Raw response:\n${raw}`)
  }

  return parsed as Omit<Step, 'id' | 'order'>[]
}

export function validateGeneratedSteps(
  steps: Omit<Step, 'id' | 'order'>[],
  capturedElements: CapturedElement[]
): void {
  const validSelectors = new Set(capturedElements.map((el) => el.selector))

  for (let i = 0; i < steps.length; i++) {
    const step = steps[i]

    if (!step.action) {
      throw new Error(`Step ${i + 1} missing required field "action"`)
    }

    if (!VALID_ACTIONS.has(step.action)) {
      throw new Error(
        `Step ${i + 1} has invalid action "${step.action}". Valid actions: ${[...VALID_ACTIONS].join(', ')}`
      )
    }

    // Warn if selector not in captured elements (don't throw)
    if (
      step.target &&
      !validSelectors.has(step.target)
    ) {
      console.warn(
        `Warning: Step ${i + 1} selector "${step.target}" was not found in captured elements. ` +
        `It may not exist on the page.`
      )
    }
  }
}

export async function generateScript(options: GenerateOptions): Promise<GenerateResult> {
  const { url, prompt, apiKey, capturedElements, model = 'claude-3-5-haiku-20241022' } = options

  const key = apiKey || process.env.ANTHROPIC_API_KEY
  if (!key) {
    throw new Error(
      'ANTHROPIC_API_KEY is required. Set it as an environment variable or pass apiKey option.'
    )
  }

  // Dynamically import Anthropic SDK to avoid hard dependency at module load
  let Anthropic: typeof import('@anthropic-ai/sdk').default
  try {
    const mod = await import('@anthropic-ai/sdk')
    Anthropic = mod.default
  } catch {
    throw new Error(
      '@anthropic-ai/sdk is not installed. Run: npm install @anthropic-ai/sdk'
    )
  }

  const client = new Anthropic({ apiKey: key })

  const elements: CapturedElement[] = capturedElements ?? []

  const systemPrompt = buildSystemPrompt()
  const userMessage = buildUserMessage(url, elements, prompt)

  const response = await client.messages.create({
    model,
    max_tokens: 2000,
    temperature: 0,
    system: systemPrompt,
    messages: [{ role: 'user', content: userMessage }],
  })

  const tokensUsed = response.usage.input_tokens + response.usage.output_tokens

  const textBlock = response.content.find((c) => c.type === 'text')
  if (!textBlock || textBlock.type !== 'text') {
    throw new Error('AI returned no text content')
  }

  const rawSteps = parseAIResponse(textBlock.text)

  // Validate (logs warnings, throws on invalid action fields)
  validateGeneratedSteps(rawSteps, elements)

  // Assign id and order
  const steps: Step[] = rawSteps.map((s, i) => ({
    id: nanoid(),
    order: i + 1,
    target: s.target ?? null,
    targetLabel: (s as Record<string, unknown>).targetLabel as string || s.target || 'page',
    action: s.action,
    duration: s.duration,
    zoom: s.zoom,
    easing: s.easing,
    annotation: s.annotation,
    highlightColor: s.highlightColor,
  }))

  const estimatedDuration = steps.reduce((sum, s) => sum + s.duration, 0)

  return { steps, capturedElements: elements, tokensUsed, estimatedDuration }
}
