import { capture } from '../pkg/index'

const urls = [
  'https://www.framer.com',
  'https://bluor.ai',
  'https://wisprflow.ai',
]

async function main() {
  for (const url of urls) {
    console.log(`\n${'='.repeat(60)}`)
    console.log(`Capturing: ${url}`)
    console.log('='.repeat(60))
    try {
      const result = await capture(url, { width: 1280, height: 720 })
      console.log(`Page height: ${result.pageHeight}px`)
      console.log(`Elements found: ${result.elements.length}`)
      console.log('\nElements:')
      for (const el of result.elements) {
        console.log(`  [${el.tagName.padEnd(8)}] ${el.selector.padEnd(50)} "${el.innerText.slice(0, 50)}"`)
      }
    } catch (e: any) {
      console.error(`  ERROR: ${e.message}`)
    }
  }
}

main()
