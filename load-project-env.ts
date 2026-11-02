import { existsSync } from 'node:fs'
import { join } from 'node:path'
import dotenv from 'dotenv'

/**
 * Load the project-root .env into process.env.
 * Existing shell variables are left unchanged (dotenv override: false).
 * This module is imported first from keystone.ts so SESSION_SECRET and
 * later request-time reads see the file.
 */
export function loadProjectEnv(cwd = process.cwd()): { loaded: boolean } {
  const envPath = join(cwd, '.env')
  if (!existsSync(envPath)) return { loaded: false }
  dotenv.config({ path: envPath, override: false, quiet: true })
  return { loaded: true }
}

loadProjectEnv()
