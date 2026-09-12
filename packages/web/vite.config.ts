import { execSync } from 'node:child_process';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const GITHUB_REPO = 'Seyfinn/Moteur-jeu-carte-v1';

/** Ce que le client affiche dans son coin de version (`VersionBadge`). */
export interface BuildVersion {
  pr: number | null;
  sha: string | null;
}

function git(args: string): string | null {
  try {
    return execSync(`git ${args}`, { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim() || null;
  } catch {
    return null;
  }
}

/**
 * Numéro de la PR dont le build est issu, pour savoir quelle version du site on regarde.
 *
 * Chaque version part en production par un merge de PR sur `main`, donc le commit déployé
 * est presque toujours un commit de merge « Merge pull request #N » : c'est la lecture la
 * moins chère, sans réseau. Sinon (squash, commit direct, preview Render d'une branche),
 * on demande à GitHub quelle PR porte ce commit -- le dépôt est public, l'appel se fait
 * sans jeton et un échec (hors-ligne, quota, commit jamais poussé) laisse simplement le
 * numéro vide. Render fournit `RENDER_GIT_COMMIT` ; en local on lit `git`.
 */
async function resolveBuildVersion(): Promise<BuildVersion> {
  const sha = process.env['RENDER_GIT_COMMIT'] ?? git('rev-parse HEAD');
  const message = git('log -1 --pretty=%s');
  const merged = message?.match(/^Merge pull request #(\d+)\b/);
  if (merged) return { pr: Number(merged[1]), sha };
  if (!sha) return { pr: null, sha: null };

  try {
    const res = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits/${sha}/pulls`, {
      headers: { Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!res.ok) return { pr: null, sha };
    const pulls = (await res.json()) as Array<{ number: number; merge_commit_sha: string | null }>;
    const own = pulls.find((p) => p.merge_commit_sha === sha) ?? pulls[0];
    return { pr: own?.number ?? null, sha };
  } catch {
    return { pr: null, sha };
  }
}

export default defineConfig(async () => {
  const version = await resolveBuildVersion();
  return {
    plugins: [react()],
    define: {
      __BUILD_VERSION__: JSON.stringify(version),
    },
    server: {
      port: Number(process.env.PORT) || 5173,
    },
  };
});
