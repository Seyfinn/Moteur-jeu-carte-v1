import {
  getCharacterCard,
  getObjectCard,
  getTerrainCard,
  type AbilityDef,
  type AttackDef,
  type CharacterInstance,
  type GameState,
  type StatusInstance,
} from 'engine';

// Une `description` VIDE est une information, pas un oubli : elle veut dire que
// l'illustration de la carte n'imprime rien pour cette attaque (souvent le cas -- juste un
// nom et un chiffre d'ATK). On n'affiche alors aucun paragraphe, plutôt qu'un blanc.

import { toneForStatus } from './statusEffects';
import { attackReadouts, liveAttacks } from './boardActions';

/**
 * Ce que la carte IMPRIME, par opposition à sa plomberie. Une capacité `hidden` porte une
 * phrase écrite par le moteur (« Compte les personnages tués par Chainsaw Man, pour
 * Mangeur de démons. ») : elle explique le code, pas la carte, et n'a rien à faire sous
 * les yeux du joueur -- qui lisait jusqu'ici deux lignes « Autel Démoniaque » sous un
 * terrain dont le texte disait déjà tout.
 */
function printedAbilities<T extends { hidden?: boolean }>(abilities: readonly T[] | undefined): readonly T[] {
  return (abilities ?? []).filter((a) => !a.hidden);
}

const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;

/**
 * Jauge de PV de la fiche d'inspection. Même dégradé continu que sur le plateau (la teinte
 * est calculée ici et lue par la CSS), et le chiffre posé dessus plutôt qu'à côté : c'est
 * la première chose qu'on vient lire en ouvrant une fiche. Le bouclier a son propre segment
 * bleu, tracé par-dessus la barre depuis la gauche, comme sur la carte : un chiffre seul ne
 * disait pas s'il couvrait une égratignure ou la moitié des PV.
 */
function VitalsGauge({ current, max, shield }: { current: number; max: number; shield: number }) {
  const ratio = (value: number) => (max > 0 ? Math.max(0, Math.min(100, (value / max) * 100)) : 0);
  const pct = ratio(current);
  const label = `${current} PV sur ${max}${shield > 0 ? `, ${shield} de bouclier` : ''}`;
  return (
    <div
      className={`ins-hp${shield > 0 ? ' shielded' : ''}`}
      style={{ ['--hp-hue' as string]: Math.round(pct * 1.2) }}
      role="meter"
      aria-label="Points de vie"
      aria-valuemin={0}
      aria-valuemax={max}
      aria-valuenow={current}
      aria-valuetext={label}
    >
      <div className="ins-hp-fill" style={{ width: `${pct}%` }} />
      {shield > 0 && <div className="ins-hp-shield-fill" style={{ width: `${ratio(shield)}%` }} />}
      <span className="ins-hp-text">
        <strong>{current}</strong>
        <span className="ins-hp-sep">/ {max}</span>
        {shield > 0 && <em className="ins-hp-shield">+{shield} 🛡</em>}
      </span>
    </div>
  );
}

/**
 * Ce qu'une pilule de statut dit en plus de son nom : la durée qui reste, le nombre de
 * stacks, la réserve de bouclier. Séparé du nom pour que la CSS puisse le mettre en
 * évidence -- sur la carte, « Brûlure (2) » se lisait comme une note de bas de page.
 */
function statusMeter(status: StatusInstance): string | null {
  const shieldPool = Number(status.data?.['shield'] ?? 0);
  if (shieldPool > 0) return `${shieldPool} 🛡`;
  if (status.remainingTurns !== undefined) return plural(status.remainingTurns, 'tour');
  if (status.statusId === 'bleed') return `×${Number(status.data?.['stacks'] ?? 1)}`;
  // « Tours compté » : le décompte vit dans `data.ticksRemaining`, pas dans `remainingTurns`
  // (cf. turn.ts::resolveSurvivalVow).
  if (status.statusId === 'survival-vow') return plural(Number(status.data?.['ticksRemaining'] ?? 0), 'tour');
  return null;
}

function StatusPill({ status }: { status: StatusInstance }) {
  const name = status.label || status.statusId;
  const meter = statusMeter(status);
  return (
    <span className={`ins-pill tone-${toneForStatus(status.statusId)}`} title={`${name} (${status.statusId})`}>
      <span className="ins-pill-name">{name}</span>
      {meter && <b className="ins-pill-meter">{meter}</b>}
    </span>
  );
}

/**
 * Petites étiquettes de cadrage d'une capacité : sa fréquence, d'où elle se lance, ce
 * qu'elle coûte en tour. Ce ne sont PAS le texte de la carte (qui reste affiché tel quel
 * en dessous) mais ce que le moteur en fait -- et, quand l'instance est en jeu, ce qu'il
 * en reste : une capacité « 1×/partie » déjà consommée doit se lire comme épuisée avant
 * même qu'on la lance pour rien.
 */
function abilityMeta(ability: AbilityDef, instance?: CharacterInstance): { text: string; spent?: boolean }[] {
  const meta: { text: string; spent?: boolean }[] = [];
  // Seule une capacité active sans trigger est lancée à la main : c'est pour elle que la
  // fréquence a un sens. Une passive à trigger se déclenche autant de fois que son event.
  const manual = ability.kind === 'active' && ability.trigger === undefined;
  const perTurn = ability.usesPerTurn ?? 1;
  const perGame = ability.usesPerGame;

  if (perGame !== undefined) {
    const used = instance?.abilityUsesThisGame[ability.id] ?? 0;
    const spent = used >= perGame;
    meta.push({
      text: instance ? (spent ? 'Épuisée pour la partie' : `${perGame - used}/${perGame} par partie`) : `${perGame}× par partie`,
      spent,
    });
  }
  if (manual && perTurn !== Infinity) {
    const used = instance?.abilityUsesThisTurn[ability.id] ?? 0;
    const spent = used >= perTurn;
    // Déjà épuisée pour toute la partie : inutile de dire en plus qu'elle l'est ce tour.
    if (!meta.some((m) => m.spent)) {
      meta.push({
        text: instance ? (spent ? 'Utilisée ce tour' : `${perTurn - used}/${perTurn} ce tour`) : `${perTurn}× par tour`,
        spent,
      });
    }
  }
  if (ability.usableFromBench) meta.push({ text: 'Depuis le banc' });
  // Une capacité est gratuite par défaut ; seule une valeur explicitement `true` est
  // affichée (une fonction dépend du contexte, on ne peut rien promettre).
  if (ability.endsTurn === true) meta.push({ text: 'Termine le tour' });
  return meta;
}

/** Une attaque ferme le tour par défaut : on ne signale que l'exception, statique. */
function attackMeta(attack: AttackDef): { text: string }[] {
  return attack.endsTurn === false ? [{ text: 'Ne termine pas le tour' }] : [];
}

function MetaRow({ items }: { items: { text: string; spent?: boolean }[] }) {
  if (items.length === 0) return null;
  return (
    <span className="ins-meta">
      {items.map((m) => (
        <span key={m.text} className={`ins-meta-chip${m.spent ? ' spent' : ''}`}>
          {m.text}
        </span>
      ))}
    </span>
  );
}

/**
 * Fiche d'un personnage. Avec `instance` + `state`, les ATK affichés sont ceux du moment
 * (dégâts évolutifs de Guts/Hulk/Mundo, buffs, malus) et non les valeurs imprimées : sans
 * `state` -- deck-builder, aperçu d'une carte hors jeu -- on retombe sur la carte nue.
 */
export function characterDetailBody(cardId: string, instance?: CharacterInstance, state?: GameState) {
  const def = getCharacterCard(cardId);
  const readouts = instance && state ? attackReadouts(state, instance) : [];
  // En jeu, la fiche liste ce que le personnage peut réellement déclarer : son attaque
  // empruntée ("Livre de Chrollo") en fait partie, ses propres attaques n'en font plus
  // partie tant que le prêt tient. Hors partie (deck-builder, aperçu), la carte nue.
  const attacks = instance && state ? liveAttacks(state, instance.instanceId) : def.attacks;
  const currentHP = instance ? Math.max(0, instance.currentMaxHP - instance.damage) : def.baseMaxHP;
  const maxHP = instance ? instance.currentMaxHP : def.baseMaxHP;
  // Même total que sur la carte : bouclier du moteur + réserves portées par un statut
  // (`data.shield`, cf. Mana Barrier de Blitzcrank).
  const shieldTotal = instance
    ? instance.shield + instance.statuses.reduce((sum, st) => sum + Math.max(0, Number(st.data?.['shield'] ?? 0)), 0)
    : 0;
  const statuses = instance ? instance.statuses.filter((s) => !s.hidden) : [];
  const abilities = printedAbilities(def.abilities);

  return (
    <>
      <VitalsGauge current={currentHP} max={maxHP} shield={shieldTotal} />

      {statuses.length > 0 && (
        <div className="ins-pills" aria-label="Statuts en cours">
          {statuses.map((s, i) => (
            <StatusPill key={`${s.statusId}-${i}`} status={s} />
          ))}
        </div>
      )}

      {attacks.length > 0 && (
        <section className="ins-block ins-block-attack">
          <h4>
            Attaques <span className="ins-block-count">{attacks.length}</span>
          </h4>
          {attacks.map((a) => {
            const live = readouts.find((r) => r.id === a.id);
            const effective = live ? live.effective : a.baseATK;
            const shifted = live !== undefined && live.effective !== a.baseATK;
            return (
              <article key={a.id} className="ins-entry">
                <header className="ins-entry-head">
                  <span className="ins-entry-name">{a.name}</span>
                  <span
                    className={`ins-badge ins-badge-atk${shifted ? (effective > a.baseATK ? ' up' : ' down') : ''}`}
                    aria-label={`${effective} points d'attaque`}
                  >
                    <strong>{effective}</strong> ATK
                  </span>
                </header>
                {/* La valeur imprimée n'apparaît que quand elle a été modifiée : une attaque
                    qui frappe pour ce qui est écrit dessus n'a rien à corriger. */}
                {shifted && (
                  <span className="ins-entry-note">
                    imprimé {a.baseATK} ATK · {effective > a.baseATK ? '+' : '−'}
                    {Math.abs(effective - a.baseATK)}
                  </span>
                )}
                <MetaRow items={attackMeta(a)} />
                {a.description && <p className="ins-entry-text">{a.description}</p>}
              </article>
            );
          })}
        </section>
      )}

      {abilities.length > 0 && (
        <section className="ins-block ins-block-talent">
          <h4>
            Talents <span className="ins-block-count">{abilities.length}</span>
          </h4>
          {abilities.map((a) => (
            <article key={a.id} className="ins-entry">
              <header className="ins-entry-head">
                <span className="ins-entry-name">{a.name}</span>
                <span className={`ins-badge ins-badge-${a.kind}`}>{a.kind === 'active' ? 'Actif' : 'Passif'}</span>
              </header>
              <MetaRow items={abilityMeta(a, instance)} />
              {a.description && <p className="ins-entry-text">{a.description}</p>}
            </article>
          ))}
        </section>
      )}
    </>
  );
}

export function objectDetailBody(cardId: string) {
  const def = getObjectCard(cardId);
  const pills = [
    def.equipment ? { key: 'equipment', tone: 'neutral', text: '🔗 Objet à lier' } : null,
    // Objet « unique » (`maxCopies: 1`) : la contrainte de deck se lit ici aussi, pas
    // seulement dans le deck-builder.
    def.maxCopies === 1 ? { key: 'unique', tone: 'freeze', text: '1× par deck' } : null,
  ].filter((p): p is { key: string; tone: string; text: string } => p !== null);
  return (
    <>
      {pills.length > 0 && (
        <div className="ins-pills">
          {pills.map((p) => (
            <span key={p.key} className={`ins-pill tone-${p.tone}`}>
              {p.text}
            </span>
          ))}
        </div>
      )}
      {def.description && <p className="ins-entry-text ins-card-text">{def.description}</p>}
    </>
  );
}

export function terrainDetailBody(cardId: string) {
  const def = getTerrainCard(cardId);
  const effects = printedAbilities(def.abilities);
  return (
    <>
      <div className="ins-pills">
        <span className="ins-pill tone-freeze">
          ⏳ {def.durationTurns !== undefined ? plural(def.durationTurns, 'tour') : 'Durée indéfinie'}
        </span>
      </div>
      {def.description && <p className="ins-entry-text ins-card-text">{def.description}</p>}
      {effects.length > 0 && (
        <section className="ins-block ins-block-talent">
          <h4>
            Effets <span className="ins-block-count">{effects.length}</span>
          </h4>
          {effects.map((a) => (
            <article key={a.id} className="ins-entry">
              <header className="ins-entry-head">
                <span className="ins-entry-name">{a.name}</span>
              </header>
              {a.description && <p className="ins-entry-text">{a.description}</p>}
            </article>
          ))}
        </section>
      )}
    </>
  );
}

export function hiddenCardDetailBody() {
  return <p className="ins-entry-text ins-card-text">Carte cachée -- son identité n'est révélée qu'une fois jouée.</p>;
}
