#!/usr/bin/env node

import { render, capture, RenderInput, StepInput } from './index'
import fs from 'fs'
import path from 'path'

const HELP = `
demoscript — Generate polished demo videos from any URL

USAGE
  demoscript render <url> [options]       Render a video from a URL + JSON script
  demoscript render --script <file.json>  Render from a JSON script file
  demoscript capture <url>                Capture page elements for scripting
  demoscript --help                       Show this help

RENDER OPTIONS
  --script, -s <file>    Path to JSON script file
  --output, -o <dir>     Output directory (default: ./output)
  --format, -f <fmt>     Output format: mp4, gif (default: mp4)
  --fps <n>              Frames per second (default: 24)
  --width <n>            Viewport width (default: 1280)
  --height <n>           Viewport height (default: 720)

EXAMPLES
  # Quick render with inline steps
  demoscript render https://your-site.com --script demo.json

  # Capture elements to plan your script
  demoscript capture https://your-site.com

  # Render a GIF at 12fps
  demoscript render --script demo.json --format gif --fps 12

SCRIPT FILE FORMAT (demo.json)
  {
    "url": "https://your-site.com",
    "steps": [
      { "action": "wait", "duration": 1 },
      { "action": "scroll-to", "target": "#pricing", "duration": 2 },
      { "action": "highlight", "target": ".plan-pro", "duration": 1.5, "highlightColor": "#6366F1" },
      { "action": "zoom-in", "target": "h1", "duration": 1.5, "zoom": 2.0 },
      { "action": "zoom-out", "duration": 1 }
    ]
  }

AVAILABLE ACTIONS
  wait          Hold the current frame
  scroll-to     Smooth scroll to a target element
  zoom-in       Zoom into a target element
  zoom-out      Zoom back to normal
  highlight     Show a colored border around an element
  pan           Pan the viewport to an element
  cursor-move   Animate cursor to an element
  click         Move cursor to element and click
`

interface ScriptFile {
  url?: string
  steps: StepInput[]
  viewport?: { width: number; height: number }
  fps?: number
  outputFormat?: 'mp4' | 'gif' | 'webm'
}

function parseArgs(argv: string[]) {
  const args: Record<string, string | boolean> = {}
  const positional: string[] = []

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) {
        args[key] = next
        i++
      } else {
        args[key] = true
      }
    } else if (arg.startsWith('-') && arg.length === 2) {
      const shortMap: Record<string, string> = {
        s: 'script', o: 'output', f: 'format', h: 'help',
      }
      const key = shortMap[arg[1]] || arg[1]
      const next = argv[i + 1]
      if (next && !next.startsWith('-')) {
        args[key] = next
        i++
      } else {
        args[key] = true
      }
    } else {
      positional.push(arg)
    }
  }
  return { args, positional }
}

async function main() {
  const { args, positional } = parseArgs(process.argv.slice(2))

  if (args.help || positional.length === 0) {
    console.log(HELP)
    process.exit(0)
  }

  const command = positional[0]

  if (command === 'capture') {
    const url = positional[1]
    if (!url) {
      console.error('Error: URL required. Usage: demoscript capture <url>')
      process.exit(1)
    }

    const width = parseInt(args.width as string) || 1280
    const height = parseInt(args.height as string) || 720

    console.log(`Capturing ${url} ...`)
    const result = await capture(url, { width, height })

    console.log(`\nFound ${result.elements.length} elements:\n`)
    console.log('  Selector                                 | Tag        | Text')
    console.log('  ' + '-'.repeat(80))
    for (const el of result.elements) {
      const sel = el.selector.padEnd(40)
      const tag = el.tagName.padEnd(10)
      const text = el.innerText.slice(0, 40)
      console.log(`  ${sel} | ${tag} | ${text}`)
    }
    console.log(`\nPage size: ${result.pageWidth}x${result.pageHeight}`)
    console.log('Use these selectors as "target" values in your script file.')
    return
  }

  if (command === 'render') {
    const scriptPath = args.script as string | undefined
    const inlineUrl = positional[1]

    let scriptFile: ScriptFile | null = null

    if (scriptPath) {
      const resolved = path.resolve(scriptPath)
      if (!fs.existsSync(resolved)) {
        console.error(`Error: Script file not found: ${resolved}`)
        process.exit(1)
      }
      scriptFile = JSON.parse(fs.readFileSync(resolved, 'utf-8'))
    }

    const url = inlineUrl || scriptFile?.url
    if (!url) {
      console.error('Error: URL required. Provide as argument or in script file.')
      process.exit(1)
    }

    const steps = scriptFile?.steps
    if (!steps || steps.length === 0) {
      console.error('Error: No steps defined. Provide a --script file with steps.')
      process.exit(1)
    }

    const width = parseInt(args.width as string) || scriptFile?.viewport?.width || 1280
    const height = parseInt(args.height as string) || scriptFile?.viewport?.height || 720
    const fps = parseInt(args.fps as string) || scriptFile?.fps || 24
    const format = (args.format as string) || scriptFile?.outputFormat || 'mp4'
    const outputDir = (args.output as string) || './output'

    const totalDuration = steps.reduce((sum, s) => sum + s.duration, 0)
    console.log(`DemoScript Render`)
    console.log(`  URL:      ${url}`)
    console.log(`  Steps:    ${steps.length}`)
    console.log(`  Duration: ${totalDuration}s`)
    console.log(`  Format:   ${format}`)
    console.log(`  FPS:      ${fps}`)
    console.log(`  Viewport: ${width}x${height}`)
    console.log('')

    const input: RenderInput = {
      url,
      steps,
      viewport: { width, height },
      fps,
      outputFormat: format as 'mp4' | 'gif' | 'webm',
      outputDir: path.resolve(outputDir),
      onProgress: (p, msg) => {
        const bar = '█'.repeat(Math.round(p / 2.5)) + '░'.repeat(40 - Math.round(p / 2.5))
        process.stdout.write(`\r  [${bar}] ${Math.round(p)}% ${msg.slice(0, 50).padEnd(50)}`)
      },
    }

    const start = Date.now()
    const result = await render(input)
    const elapsed = ((Date.now() - start) / 1000).toFixed(1)

    const stat = fs.statSync(result.outputPath)
    const sizeKB = (stat.size / 1024).toFixed(0)

    console.log('\n')
    console.log(`  Done in ${elapsed}s`)
    console.log(`  Output: ${result.outputPath}`)
    console.log(`  Size:   ${sizeKB} KB`)
    console.log(`  Frames: ${result.frameCount}`)
    return
  }

  console.error(`Unknown command: ${command}`)
  console.log(HELP)
  process.exit(1)
}

main().catch((err) => {
  console.error('\nError:', err.message)
  process.exit(1)
})
