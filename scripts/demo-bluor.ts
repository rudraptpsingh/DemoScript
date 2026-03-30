/**
 * Bluor AI demo — mirrors their Product Hunt narrative:
 * "Beautiful emails, in seconds"
 *
 * Key insight: their YouTube video shows the "describe → generate" workflow.
 * We replicate that: land on the hero, cursor moves to the prompt input,
 * types a description, then scrolls to show the output section.
 *
 * Arc: Establish → move to input → type a prompt → show the result area → CTA
 */
import path from 'path'
import { render } from '../pkg/index'

async function main() {
  console.log('Rendering Bluor AI demo...')

  const result = await render({
    url: 'https://bluor.ai',
    viewport: { width: 1280, height: 720 },
    fps: 24,
    outputFormat: 'mp4',
    outputDir: path.join(process.cwd(), 'output', 'bluor'),
    onProgress: (p, msg) => process.stdout.write(`\r[${String(p).padStart(3)}%] ${msg}                `),
    steps: [
      // Wait for SPA to fully hydrate — but give viewer context immediately
      { action: 'wait', duration: 2.5, annotation: 'Bluor — beautiful emails in seconds' },

      // Highlight the hero headline
      { action: 'cursor-move', target: 'h1', duration: 0.8, easing: 'ease-out' },
      {
        action: 'highlight',
        target: 'h1',
        duration: 2.0,
        highlightColor: '#EC4899',
        annotation: 'Beautiful emails, in seconds',
      },

      // Move cursor to the prompt input and type a description
      { action: 'cursor-move', target: 'input[type="text"], textarea, input:not([type])', duration: 1.0, easing: 'ease-out' },
      {
        action: 'type',
        target: 'input[type="text"], textarea, input:not([type])',
        duration: 3.5,
        typeText: 'Black Friday sale — 50% off all plans, urgent CTA, dark theme',
        annotation: 'Describe your email...',
      },

      { action: 'wait', duration: 1.0, annotation: 'Watch it generate →' },

      // Scroll down to reveal the design output section
      {
        action: 'scroll-to',
        target: 'section:nth-of-type(2)',
        duration: 1.8,
        easing: 'ease-in-out',
      },
      { action: 'wait', duration: 0.8 },

      { action: 'cursor-move', target: 'h2', duration: 0.6, easing: 'ease-out' },
      {
        action: 'highlight',
        target: 'h2',
        duration: 2.0,
        highlightColor: '#EC4899',
        annotation: 'AI-generated, ready to send',
      },

      // Zoom into the email builder interface
      {
        action: 'zoom-in',
        target: 'main',
        duration: 1.3,
        zoom: 1.5,
        easing: 'ease-out',
        annotation: 'Describe it once. Ship it anywhere.',
      },
      { action: 'wait', duration: 2.0 },
      { action: 'zoom-out', duration: 1.0, easing: 'ease-in' },

      // Scroll to the third section to show more of the product
      {
        action: 'scroll-to',
        target: 'section:nth-of-type(3)',
        duration: 1.8,
        easing: 'ease-in-out',
      },
      { action: 'wait', duration: 1.0 },

      {
        action: 'zoom-in',
        target: 'section:nth-of-type(3)',
        duration: 1.2,
        zoom: 1.4,
        easing: 'ease-out',
        annotation: 'Works with Mailchimp, HubSpot, Klaviyo and more',
      },
      { action: 'wait', duration: 1.5 },
      { action: 'zoom-out', duration: 0.8, easing: 'ease-in' },

      // Return to top
      { action: 'scroll-to', target: 'body', duration: 2.0, easing: 'ease-in-out', scrollOffset: 0 },
      { action: 'wait', duration: 1.5, annotation: 'bluor.ai — start free' },
    ],
  })

  console.log(`\n\nDone! Output: ${result.outputPath}`)
  console.log(`Frames: ${result.frameCount} | Duration: ${result.duration}s`)
}

main()
