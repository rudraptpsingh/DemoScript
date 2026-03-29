import { renderScript } from './engine'
import { DemoScript } from '../types'
import path from 'path'

const testScript: DemoScript = {
  id: 'test-001',
  url: 'data:text/html,<html><body style="font-family:sans-serif;margin:0;padding:40px;background:%23111;color:white"><h1 id="hero">DemoScript Test Page</h1><p>This is a test page for the rendering engine.</p><section id="features" style="margin-top:300px;padding:40px;background:%23222;border-radius:12px"><h2>Features</h2><p>Scroll, zoom, highlight and more.</p></section><footer id="footer" style="margin-top:600px;padding:40px;background:%23333;border-radius:12px"><p>Footer content here</p></footer></body></html>',
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
      duration: 1.5,
    },
    {
      id: '2',
      order: 2,
      target: '#hero',
      targetLabel: 'Main Heading',
      action: 'highlight',
      duration: 2.0,
      highlightColor: '#6366F1',
    },
    {
      id: '3',
      order: 3,
      target: '#hero',
      targetLabel: 'Main Heading',
      action: 'zoom-in',
      duration: 1.5,
      zoom: 2.0,
      easing: 'ease-in-out',
    },
    {
      id: '4',
      order: 4,
      target: '#hero',
      targetLabel: 'Main Heading',
      action: 'zoom-out',
      duration: 1.0,
      zoom: 2.0,
      easing: 'ease-in-out',
    },
    {
      id: '5',
      order: 5,
      target: '#footer',
      targetLabel: 'Footer',
      action: 'scroll-to',
      duration: 2.0,
      easing: 'ease-in-out',
    },
  ],
}

async function main() {
  console.log('Starting test render...')
  const outputPath = await renderScript({
    script: testScript,
    outputDir: path.join(process.cwd(), 'output'),
    onProgress: (p, msg) => console.log(`[${p}%] ${msg}`),
  })
  console.log(`\nSuccess! Video at: ${outputPath}`)
}

main().catch(console.error)
