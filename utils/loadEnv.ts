import * as dotenv from 'dotenv';
import * as fs from 'fs';
import * as path from 'path';

/**
 * Load `.env` from CWD (repo root by convention), filling only variables
 * that are unset or empty in the current environment. A non-empty shell
 * export still wins — this matches user intent when an ad-hoc override is
 * set via `VAR=value node ...`, but rescues the common case where a login
 * shell exports a key as the empty string (which `dotenv.config()` alone
 * would treat as "already set" and skip).
 */
export function loadEnv(): void {
  const envPath = path.join(process.cwd(), '.env');
  if (!fs.existsSync(envPath)) return;
  const parsed = dotenv.parse(fs.readFileSync(envPath));
  for (const [key, value] of Object.entries(parsed)) {
    const current = process.env[key];
    if (current === undefined || current === '') {
      process.env[key] = value;
    }
  }
}
