/**
 * Framer demo — mirrors their Product Hunt gallery narrative:
 * "Launch websites with enterprise needs at startup speeds"
 *
 * Arc: Establish the product → show the AI builder → show scale features → CTA
 */
import path from 'path'
import { render } from '../pkg/index'

async function main() {
  console.log('Rendering Framer demo...')

  const result = await render({
    url: 'https://www.framer.com',
    viewport: { width: 1280, height: 720 },
    fps: 24,
    outputFormat: 'mp4',
    outputDir: path.join(process.cwd(), 'output', 'framer'),
    onProgress: (p, msg) => process.stdout.write(`\r[${String(p).padStart(3)}%] ${msg}                `),
    steps: [
      // Establish: let the page breathe, viewer reads the hero
      { action: 'wait', duration: 2.0, annotation: 'Framer — launch websites at startup speed' },

      // Guide eye to the headline with cursor, then zoom in
      { action: 'cursor-move', target: 'h1.framer-text', duration: 0.8, easing: 'ease-out' },
      {
        action: 'zoom-in',
        target: 'h1.framer-text',
        duration: 1.2,
        zoom: 1.7,
        easing: 'ease-out',
      },
      // Hold on the headline — let viewer read it
      { action: 'wait', duration: 1.5, annotation: 'Build better sites, faster' },
      { action: 'zoom-out', duration: 1.0, easing: 'ease-in' },

      // Transition: scroll to the AI section
      { action: 'wait', duration: 0.5 },
      {
        action: 'scroll-to',
        target: '#design',
        duration: 1.8,
        easing: 'ease-in-out',
      },
      { action: 'wait', duration: 0.8 },

      // Cursor moves to the AI heading — signals intent before highlight
      { action: 'cursor-move', target: 'h2.framer-text', duration: 0.7, easing: 'ease-out' },
      {
        action: 'highlight',
        target: 'h2.framer-text',
        duration: 2.2,
        highlightColor: '#6366F1',
        annotation: 'AI generates site layouts in seconds',
      },

      // Zoom into the Wireframer UI mockup visible below the h2
      {
        action: 'zoom-in',
        target: '#design',
        duration: 1.3,
        zoom: 1.5,
        easing: 'ease-out',
        annotation: 'Skip the blank canvas entirely',
      },
      { action: 'wait', duration: 1.5 },
      { action: 'zoom-out', duration: 1.0, easing: 'ease-in' },

      // Scroll to the enterprise/analytics section
      { action: 'wait', duration: 0.5 },
      {
        action: 'scroll-to',
        target: 'section.framer-ab89yv',
        duration: 2.0,
        easing: 'ease-in-out',
        scrollOffset: 120,
      },
      { action: 'wait', duration: 1.0 },

      // Hover over the section heading to show it's interactive
      { action: 'hover', target: 'h2.framer-text', duration: 1.2 },
      {
        action: 'highlight',
        target: 'section.framer-ab89yv',
        duration: 2.0,
        highlightColor: '#10B981',
        annotation: 'Analytics, A/B testing, CMS, SEO — all built in',
      },

      // End: scroll back to top, leave on the hero CTA
      { action: 'scroll-to', target: 'header', duration: 2.2, easing: 'ease-in-out', scrollOffset: 0 },
      { action: 'cursor-move', target: 'nav.framer-MZyqb', duration: 0.6 },
      { action: 'wait', duration: 1.5, annotation: 'framer.com' },
    ],
  })

  console.log(`\n\nDone! Output: ${result.outputPath}`)
  console.log(`Frames: ${result.frameCount} | Duration: ${result.duration}s`)
}

main()
