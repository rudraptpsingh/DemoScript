import fs from 'fs'
import path from 'path'

const OUTPUT_DIR = path.join(process.cwd(), '.demoscript', 'output')
const MAX_AGE_HOURS = 24

export function cleanupOldFiles() {
  if (!fs.existsSync(OUTPUT_DIR)) return

  const now = Date.now()
  const maxAge = MAX_AGE_HOURS * 60 * 60 * 1000

  fs.readdirSync(OUTPUT_DIR).forEach((file) => {
    const filePath = path.join(OUTPUT_DIR, file)
    const stat = fs.statSync(filePath)

    if (now - stat.mtimeMs > maxAge) {
      fs.unlinkSync(filePath)
      console.log(`Cleaned up old file: ${file}`)
    }
  })
}
