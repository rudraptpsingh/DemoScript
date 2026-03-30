/**
 * Wispr Flow demo — mirrors their Product Hunt gallery narrative:
 * "Speak naturally, write perfectly & 4x faster in every app"
 *
 * Arc: Hook with the value prop → show the speed proof → show app breadth → CTA
 */
import path from 'path'
import { render } from '../pkg/index'

async function main() {
  console.log('Rendering Wispr Flow demo...')

  const result = await render({
    url: 'https://wisprflow.ai',
    viewport: { width: 1280, height: 720 },
    fps: 24,
    outputFormat: 'mp4',
    outputDir: path.join(process.cwd(), 'output', 'wisprflow'),
    onProgress: (p, msg) => process.stdout.write(`\r[${String(p).padStart(3)}%] ${msg}                `),
    steps: [
      // Establish — let viewer absorb the hero
      { action: 'wait', duration: 2.0, annotation: 'Wispr Flow — voice-to-text in every app' },

      // Move cursor to the headline, then highlight — shows a human looking at it
      { action: 'cursor-move', target: 'h1.text-wrap-balance', duration: 0.9, easing: 'ease-out' },
      {
        action: 'highlight',
        target: 'h1.text-wrap-balance',
        duration: 2.0,
        highlightColor: '#7C3AED',
        annotation: "Don't type — just speak",
      },

      // Zoom into the hero content (tagline + live transcription widget)
      {
        action: 'zoom-in',
        target: 'div.hero_content',
        duration: 1.3,
        zoom: 1.6,
        easing: 'ease-out',
        annotation: 'Messy speech → polished text, instantly',
      },
      { action: 'wait', duration: 1.8 },
      { action: 'zoom-out', duration: 1.0, easing: 'ease-in' },

      // Transition to the speed proof section
      { action: 'wait', duration: 0.4 },
      {
        action: 'scroll-to',
        target: 'h2.heading-style-h1',
        duration: 2.0,
        easing: 'ease-in-out',
        scrollOffset: 180,
      },
      { action: 'wait', duration: 0.8 },

      // Cursor lands on the stat, zoom in to make it land
      { action: 'cursor-move', target: 'h2.heading-style-h1', duration: 0.7, easing: 'ease-out' },
      {
        action: 'zoom-in',
        target: 'h2.heading-style-h1',
        duration: 1.2,
        zoom: 2.0,
        easing: 'ease-out',
        annotation: '4x faster than typing',
      },
      { action: 'wait', duration: 2.0 },
      { action: 'zoom-out', duration: 1.0, easing: 'ease-in' },

      // Scroll to app integrations — show the breadth
      { action: 'wait', duration: 0.4 },
      {
        action: 'scroll-to',
        target: 'section.section_app-integrations',
        duration: 2.0,
        easing: 'ease-in-out',
        scrollOffset: 100,
      },
      { action: 'wait', duration: 0.8 },

      // Highlight the "works everywhere" headline
      { action: 'cursor-move', target: 'h2.text-color-secondary', duration: 0.7, easing: 'ease-out' },
      {
        action: 'highlight',
        target: 'h2.text-color-secondary',
        duration: 2.0,
        highlightColor: '#7C3AED',
        annotation: 'Works in every app on iPhone, Mac, Windows, Android',
      },

      // Scroll to features grid — personal dictionary, snippet library
      {
        action: 'scroll-to',
        target: 'section.section_features',
        duration: 2.0,
        easing: 'ease-in-out',
        scrollOffset: 80,
      },
      { action: 'wait', duration: 0.8 },

      {
        action: 'zoom-in',
        target: 'div.features_grid-top',
        duration: 1.3,
        zoom: 1.5,
        easing: 'ease-out',
        annotation: 'AI auto-edits, personal dictionary, snippet library',
      },
      { action: 'wait', duration: 2.0 },
      { action: 'zoom-out', duration: 1.0, easing: 'ease-in' },

      // Return to hero CTA
      {
        action: 'scroll-to',
        target: 'section.section_hero',
        duration: 2.2,
        easing: 'ease-in-out',
        scrollOffset: 0,
      },
      { action: 'cursor-move', target: 'main.main-wrapper', duration: 0.5 },
      { action: 'wait', duration: 1.5, annotation: 'wisprflow.ai — free on Mac, Windows, iOS, Android' },
    ],
  })

  console.log(`\n\nDone! Output: ${result.outputPath}`)
  console.log(`Frames: ${result.frameCount} | Duration: ${result.duration}s`)
}

main()
