import Database from 'better-sqlite3'
import path from 'path'
import fs from 'fs'

const DB_PATH = path.join(process.cwd(), '.demoscript', 'jobs.db')
fs.mkdirSync(path.dirname(DB_PATH), { recursive: true })

const db = new Database(DB_PATH)

db.exec(`
  CREATE TABLE IF NOT EXISTS jobs (
    id TEXT PRIMARY KEY,
    script_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    progress INTEGER NOT NULL DEFAULT 0,
    current_step TEXT NOT NULL DEFAULT '',
    output_path TEXT,
    download_url TEXT,
    error TEXT,
    created_at TEXT NOT NULL,
    completed_at TEXT
  );
`)

export interface JobRow {
  id: string
  script_json: string
  status: string
  progress: number
  current_step: string
  output_path: string | null
  download_url: string | null
  error: string | null
  created_at: string
  completed_at: string | null
}

export const jobsDb = {
  create: (id: string, scriptJson: string) => {
    db.prepare(
      `
      INSERT INTO jobs (id, script_json, status, progress, current_step, created_at)
      VALUES (?, ?, 'pending', 0, 'Queued', ?)
    `
    ).run(id, scriptJson, new Date().toISOString())
  },

  update: (
    id: string,
    updates: Partial<Omit<JobRow, 'id' | 'script_json' | 'created_at'>>
  ) => {
    const columnMap: Record<string, string> = {
      status: 'status',
      progress: 'progress',
      current_step: 'current_step',
      output_path: 'output_path',
      download_url: 'download_url',
      error: 'error',
      completed_at: 'completed_at',
    }
    const entries = Object.entries(updates).filter(
      ([k]) => columnMap[k] !== undefined
    )
    if (entries.length === 0) return

    const fields = entries.map(([k]) => `${columnMap[k]} = ?`).join(', ')
    const values = entries.map(([, v]) => v)
    db.prepare(`UPDATE jobs SET ${fields} WHERE id = ?`).run(...values, id)
  },

  get: (id: string): JobRow | undefined => {
    return db.prepare('SELECT * FROM jobs WHERE id = ?').get(id) as
      | JobRow
      | undefined
  },
}
