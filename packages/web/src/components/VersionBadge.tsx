/**
 * Coin de version, en bas à droite de toutes les vues : le numéro de la PR dont le build
 * est issu (résolu au build par `vite.config.ts`), pour savoir d'un coup d'œil quelle
 * version du site on regarde. Sans PR connue (commit jamais poussé, hors-ligne au build),
 * on retombe sur le début du SHA ; sans rien du tout, le coin n'est pas rendu.
 */
export function VersionBadge() {
  const { pr, sha } = __BUILD_VERSION__;
  if (pr === null && !sha) return null;
  const label = pr !== null ? `PR #${pr}` : sha!.slice(0, 7);
  const href = pr !== null
    ? `https://github.com/Seyfinn/Moteur-jeu-carte-v1/pull/${pr}`
    : `https://github.com/Seyfinn/Moteur-jeu-carte-v1/commit/${sha}`;
  return (
    <a
      className="version-badge"
      href={href}
      target="_blank"
      rel="noreferrer"
      title={sha ? `Commit ${sha}` : undefined}
    >
      {label}
    </a>
  );
}
