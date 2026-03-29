import { Pool } from 'pg'

export const pool = new Pool({ connectionString: process.env.DATABASE_URL })

export async function initDb(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS api_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      key_hash TEXT NOT NULL UNIQUE,
      key_prefix TEXT NOT NULL,
      owner_email TEXT NOT NULL UNIQUE,
      tier TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'pro', 'team')),
      renders_this_month INTEGER NOT NULL DEFAULT 0,
      render_limit_monthly INTEGER NOT NULL DEFAULT 10,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_used_at TIMESTAMPTZ,
      is_active BOOLEAN NOT NULL DEFAULT true
    );

    CREATE TABLE IF NOT EXISTS render_jobs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      api_key_id UUID NOT NULL REFERENCES api_keys(id),
      status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'complete', 'failed')),
      script_json TEXT NOT NULL,
      format TEXT NOT NULL DEFAULT 'mp4',
      progress INTEGER NOT NULL DEFAULT 0,
      current_step TEXT NOT NULL DEFAULT '',
      output_keys TEXT[] DEFAULT ARRAY[]::TEXT[],
      error_message TEXT,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      started_at TIMESTAMPTZ,
      completed_at TIMESTAMPTZ,
      expires_at TIMESTAMPTZ,
      webhook_url TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_api_keys_hash ON api_keys(key_hash);
    CREATE INDEX IF NOT EXISTS idx_render_jobs_key_status ON render_jobs(api_key_id, status);
    CREATE INDEX IF NOT EXISTS idx_render_jobs_expires ON render_jobs(expires_at) WHERE expires_at IS NOT NULL;
  `)
}
