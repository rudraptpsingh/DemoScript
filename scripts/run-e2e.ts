import { renderScript } from './engine'
import { DemoScript } from '../types'
import path from 'path'
import fs from 'fs'

const BASE_URL = process.env.TEST_URL || 'http://localhost:3099/test-site.html'

const testScript: DemoScript = {
  id: 'e2e-test-001',
  url: BASE_URL,
  viewport: { width: 1280, height: 720 },
  fps: 24,
  outputFormat: 'mp4',
  createdAt: new Date().toISOString(),
  steps: [
    {
      id: '1',
      order: 1,
      target: null,
      targetLabel: 'Full page',
      action: 'wait',
      duration: 1.0,
      annotation: 'Welcome to Acme Platform',
    },
    {
      id: '2',
      order: 2,
      target: '#hero h1',
      targetLabel: 'Hero Heading',
      action: 'highlight',
      duration: 2.0,
      highlightColor: '#6366F1',
    },
    {
      id: '3',
      order: 3,
      target: '#hero h1',
      targetLabel: 'Hero Heading',
      action: 'zoom-in',
      duration: 1.5,
      zoom: 2.0,
      easing: 'ease-in-out',
    },
    {
      id: '4',
      order: 4,
      target: '#hero h1',
      targetLabel: 'Hero Heading',
      action: 'zoom-out',
      duration: 1.0,
      zoom: 2.0,
      easing: 'ease-in-out',
    },
    {
      id: '5',
      order: 5,
      target: '#features',
      targetLabel: 'Features Section',
      action: 'scroll-to',
      duration: 2.0,
      easing: 'ease-in-out',
    },
    {
      id: '6',
      order: 6,
      target: '.feature-card',
      targetLabel: 'Feature Card',
      action: 'highlight',
      duration: 1.5,
      highlightColor: '#22c55e',
    },
    {
      id: '7',
      order: 7,
      target: '#pricing',
      targetLabel: 'Pricing Section',
      action: 'scroll-to',
      duration: 2.0,
      easing: 'ease-in-out',
    },
    {
      id: '8',
      order: 8,
      target: '.pricing-card.featured',
      targetLabel: 'Pro Plan',
      action: 'highlight',
      duration: 2.0,
      highlightColor: '#f59e0b',
      annotation: 'Most popular plan',
    },
    {
      id: '9',
      order: 9,
      target: '#footer',
      targetLabel: 'Footer',
      action: 'scroll-to',
      duration: 2.0,
      easing: 'ease-in-out',
    },
    {
      id: '10',
      order: 10,
      target: null,
      targetLabel: 'End',
      action: 'wait',
      duration: 1.0,
    },
  ],
}

async function main() {
  const outputDir = path.join(process.cwd(), 'output')

  // Clean previous test output
  const expectedOutput = path.join(outputDir, 'demo_e2e-test-001.mp4')
  if (fs.existsSync(expectedOutput)) fs.unlinkSync(expectedOutput)

  console.log('=== DemoScript E2E Test ===')
  console.log(`URL: ${testScript.url}`)
  console.log(`Steps: ${testScript.steps.length}`)
  console.log(`Expected duration: ${testScript.steps.reduce((s, st) => s + st.duration, 0)}s`)
  console.log('')

  const start = Date.now()

  try {
    const outputPath = await renderScript({
      script: testScript,
      outputDir,
      onProgress: (p, msg) => console.log(`[${Math.round(p).toString().padStart(3)}%] ${msg}`),
    })

    const elapsed = ((Date.now() - start) / 1000).toFixed(1)
    const stat = fs.statSync(outputPath)
    const sizeKB = (stat.size / 1024).toFixed(0)

    console.log('')
    console.log('=== RESULTS ===')
    console.log(`Output:   ${outputPath}`)
    console.log(`Size:     ${sizeKB} KB`)
    console.log(`Time:     ${elapsed}s`)
    console.log(`Exists:   ${fs.existsSync(outputPath)}`)
    console.log(`Size > 0: ${stat.size > 0}`)

    if (stat.size > 100 * 1024) {
      console.log('\nSUCCESS: Video file is > 100KB, looks valid')
    } else if (stat.size > 0) {
      console.log('\nWARNING: Video file exists but is small')
    } else {
      console.log('\nFAILED: Video file is empty')
      process.exit(1)
    }
  } catch (err) {
    console.error('\nFAILED:', err)
    process.exit(1)
  }
}

main()
