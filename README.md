# DemoScript

Generate polished demo videos from any URL. Define scroll, zoom, highlight, and pan actions on page elements — renders MP4/GIF automatically via headless Chromium + FFmpeg.

No screen recording. No manual clicking. Pure config-to-video.

<p align="center">
  <img src="docs/demo_readme-demo.gif" alt="DemoScript demo" width="560">
</p>

## Install

```bash
npm install demoscript
npx playwright install chromium
```

## CLI Usage

### Capture page elements

```bash
npx demoscript capture https://your-site.com
```

```
Found 12 elements:

  Selector                 | Tag        | Text
  ----------------------------------------------------------
  #hero                    | section    | Welcome to Acme...
  #features                | section    | Powerful Features...
  #pricing                 | section    | Simple Pricing...
  h1                       | h1         | Acme Platform
  .pricing-card.featured   | div        | Pro — $29/mo
  #cta                     | button     | Get Started Free
```

### Render a video

Create a script file `demo.json`:

```json
{
  "url": "https://your-site.com",
  "steps": [
    { "action": "wait", "duration": 1, "annotation": "Welcome to Acme" },
    { "action": "highlight", "target": "h1", "duration": 1.5, "highlightColor": "#6366F1" },
    { "action": "zoom-in", "target": "h1", "duration": 1.5, "zoom": 2.0 },
    { "action": "zoom-out", "duration": 1 },
    { "action": "scroll-to", "target": "#pricing", "duration": 2, "easing": "ease-in-out" },
    { "action": "highlight", "target": ".pricing-card.featured", "duration": 2, "highlightColor": "#f59e0b" }
  ]
}
```

Then render:

```bash
npx demoscript render --script demo.json
npx demoscript render --script demo.json --format gif --fps 12
npx demoscript render --script demo.json -o ./videos --width 1920 --height 1080
```

## Programmatic API

```typescript
import { render, capture } from 'demoscript'

// Discover page elements
const page = await capture('https://your-site.com')
console.log(page.elements) // [{ selector: '#hero', label: 'hero', ... }, ...]

// Render a video
const result = await render({
  url: 'https://your-site.com',
  steps: [
    { action: 'wait', duration: 1 },
    { action: 'scroll-to', target: '#pricing', duration: 2 },
    { action: 'highlight', target: '.plan-pro', duration: 1.5, highlightColor: '#6366F1' },
  ],
  fps: 24,
  outputFormat: 'mp4',       // or 'gif'
  viewport: { width: 1280, height: 720 },
  outputDir: './output',
  onProgress: (percent, message) => console.log(`${percent}% ${message}`),
})

console.log(result.outputPath) // => /path/to/output/demo_xxxxx.mp4
console.log(result.frameCount) // => 96
console.log(result.duration)   // => 4
```

## Available Actions

| Action | Description | Key Options |
|--------|-------------|-------------|
| `wait` | Hold current frame | `duration`, `annotation` |
| `scroll-to` | Smooth scroll to element | `target`, `duration`, `easing` |
| `zoom-in` | Zoom into element | `target`, `duration`, `zoom` (e.g. 2.0) |
| `zoom-out` | Zoom back to normal | `duration`, `zoom` |
| `highlight` | Colored border around element | `target`, `duration`, `highlightColor` |
| `pan` | Pan viewport to element | `target`, `duration`, `easing` |
| `cursor-move` | Animate cursor to element | `target`, `duration` |
| `click` | Move cursor and click element | `target`, `duration` |

## Step Options

```typescript
{
  action: 'scroll-to',              // Required: action type
  target: '#pricing',               // CSS selector (null for whole page)
  duration: 2,                      // Seconds
  easing: 'ease-in-out',            // 'linear' | 'ease-in' | 'ease-out' | 'ease-in-out'
  annotation: 'Check our pricing',  // Text overlay at bottom of frame
  highlightColor: '#6366F1',        // Border color for highlight action
  zoom: 2.0,                        // Magnification for zoom actions
}
```

## Web UI

DemoScript also includes a full web app with a visual timeline editor:

```bash
git clone https://github.com/rudraptpsingh/DemoScript.git
cd DemoScript
npm install
npx playwright install chromium
npm run dev
# Open http://localhost:3000
```

1. Paste a URL
2. Click elements on the page preview to add steps
3. Configure actions, durations, and easing in the timeline sidebar
4. Click "Render MP4" and download your video

## Requirements

- Node.js >= 18
- Chromium (installed via `npx playwright install chromium`)
- FFmpeg (bundled via `@ffmpeg-installer/ffmpeg`)

## License

MIT
