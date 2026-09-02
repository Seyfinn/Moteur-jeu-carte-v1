import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Loads `.env.local` from the repo root into `process.env`, if present. Real environment
 * variables (Render, CI...) always win -- this only fills in what isn't already set, and
 * silently does nothing when the file doesn't exist (production never ships it, it's
 * gitignored).
 */
function loadDotEnvLocal(): void {
  const repoRoot = path.resolve(fileURLToPath(new URL('.', import.meta.url)), '../../..');
  const envPath = path.join(repoRoot, '.env.local');

  let raw: string;
  try {
    raw = readFileSync(envPath, 'utf-8');
  } catch {
    return;
  }

  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (key && !(key in process.env)) process.env[key] = value;
  }
}

loadDotEnvLocal();
