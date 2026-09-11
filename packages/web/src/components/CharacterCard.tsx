import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react';
import { getCharacterCard, type CharacterInstance, type GameState, type StatusInstance } from 'engine';
import { CardFrame } from './CardFrame';
import { useCardInspect, useHoverCard, type HoverPayload } from './HoverCard';
import { characterDetailBody } from './cardDetails';
import { StatusEffectLayers, statusAmbienceClasses, toneForStatus } from './statusEffects';
import { AttachedObjectCards, AttachedObjectChips } from './AttachedObjects';
import { attackReadouts, type AttachedObjectView } from './boardActions';
import { CharacterActionBadges } from './gameEventBadges';
import { trackCardRect } from './cardRects';
import type { CharacterBadge, CharacterImpact } from './gameEvents';

function cardName(cardId: string): string {
  try {
    return getCharacterCard(cardId).name;
  } catch {
    return cardId;
  }
}

/**
 * Ce qu'un badge de statut a à dire : le nom écrit par la carte, et le chiffre qui compte
 * (tours restants, stacks de saignement, réserve de bouclier). Séparés pour que la carte
 * puisse dessiner le chiffre en pastille, là où « Brûlure (2) » en texte brut se lisait
 * comme un seul mot flou à la taille d'une vignette de banc.
 */
export interface StatusBadgeParts {
  name: string;
  /** Le chiffre du badge, s'il y en a un. */
  meter?: { value: number; kind: 'shield' | 'turns' | 'stacks' | 'ticks' };
  /** Phrase d'infobulle, en français, qui explique le chiffre. */
  hint: string;
}

export function statusBadgeParts(status: StatusInstance): StatusBadgeParts {
  const name = status.label || status.statusId;
  const plural = (n: number, word: string) => `${n} ${word}${n > 1 ? 's' : ''}`;
  // `data.shield` = réserve de bouclier portée par un statut (Mana Barrier de Blitzcrank).
  // Elle fond à chaque coup encaissé : sans le chiffre, le badge ne disait pas ce qu'il
  // reste à absorber.
  const shieldPool = Number(status.data?.['shield'] ?? 0);
  if (shieldPool > 0) {
    return { name, meter: { value: shieldPool, kind: 'shield' }, hint: `${name} — ${plural(shieldPool, 'point')} de bouclier à absorber` };
  }
  if (status.remainingTurns !== undefined) {
    const turns = status.remainingTurns;
    return { name, meter: { value: turns, kind: 'turns' }, hint: `${name} — ${plural(turns, 'tour')} restant${turns > 1 ? 's' : ''}` };
  }
  if (status.statusId === 'bleed') {
    const stacks = Number(status.data?.['stacks'] ?? 1);
    return { name, meter: { value: stacks, kind: 'stacks' }, hint: `${name} — ${plural(stacks, 'stack')}` };
  }
  // « Tours compté » : pas de `remainingTurns` (décompte géré par le moteur en dehors du
  // tick générique, cf. turn.ts::resolveSurvivalVow) -- sans ça, le badge ne dirait pas
  // combien de tours il reste à tenir.
  if (status.statusId === 'survival-vow') {
    const ticks = Number(status.data?.['ticksRemaining'] ?? 0);
    return { name, meter: { value: ticks, kind: 'ticks' }, hint: `${name} — ${plural(ticks, 'tour')} à tenir` };
  }
  return { name, hint: name };
}

/**
 * Statuses carry a human `label` written by the card that applied them ("Brûlure (La
 * flamme)"); the raw `statusId` is an internal key and reads as noise on the board, so
 * it moves to the tooltip instead. Version texte brut des `statusBadgeParts`, pour les
 * surfaces qui n'ont qu'une ligne (le panneau d'inspection).
 */
export function statusBadgeText(status: StatusInstance): string {
  const { name, meter } = statusBadgeParts(status);
  if (!meter) return name;
  switch (meter.kind) {
    case 'shield':
      return `${name} ${meter.value} 🛡`;
    case 'stacks':
      return `${name} x${meter.value}`;
    default:
      return `${name} (${meter.value})`;
  }
}

/** Le chiffre d'un badge tel qu'il est dessiné en pastille sur la carte. */
function statusMeterLabel(meter: NonNullable<StatusBadgeParts['meter']>): string {
  switch (meter.kind) {
    case 'shield':
      return `${meter.value} 🛡`;
    case 'stacks':
      return `×${meter.value}`;
    default:
      return String(meter.value);
  }
}

/**
 * Au banc, la rangée de statuts tient sur UNE ligne rognée par `overflow: hidden` : au-delà
 * de quelques badges, les suivants disparaissaient sans laisser de trace. On n'en dessine
 * que ce nombre, et un « +N » dit qu'il y en a d'autres (la fiche les liste tous).
 */
const MAX_BADGES_ON_SMALL_CARD = 3;

/**
 * La rangée de badges de statut d'une carte. `compact` = vignette (banc, cimetière) où
 * la place manque : les badges au-delà du plafond sont repliés dans un « +N ».
 */
function StatusBadges({ statuses, compact }: { statuses: StatusInstance[]; compact: boolean }) {
  const shown = compact ? statuses.slice(0, MAX_BADGES_ON_SMALL_CARD) : statuses;
  const hidden = statuses.slice(shown.length);
  const hiddenText = hidden.map((st) => statusBadgeText(st));
  return (
    <div className="statuses" role="list" aria-label="Statuts">
      {shown.map((s, i) => {
        const parts = statusBadgeParts(s);
        return (
          // Clé portée par le STATUT et non par son rang : le badge n'est alors monté
          // qu'une fois, à la pose, et c'est ce montage qui joue son apparition. Avec
          // l'index, toute la rangée se remontait dès qu'un statut expirait au milieu.
          <span
            key={`${s.statusId}:${s.sourceCardInstanceId ?? i}`}
            className={`status-badge status-tone-${toneForStatus(s.statusId)}`}
            title={parts.hint}
            role="listitem"
            aria-label={parts.hint}
          >
            <span className="status-badge-name">{parts.name}</span>
            {parts.meter && (
              <span className={`status-badge-meter status-meter-${parts.meter.kind}`} aria-hidden="true">
                {statusMeterLabel(parts.meter)}
              </span>
            )}
          </span>
        );
      })}
      {hidden.length > 0 && (
        <span
          className="status-badge status-badge-more"
          role="listitem"
          title={hiddenText.join('\n')}
          aria-label={`${hidden.length} autre${hidden.length > 1 ? 's' : ''} statut${hidden.length > 1 ? 's' : ''} : ${hiddenText.join(', ')}`}
        >
          +{hidden.length}
        </span>
      )}
    </div>
  );
}

/**
 * Les chiffres vitaux d'un personnage, dérivés de sa seule instance. Un bouclier peut venir
 * du moteur (`char.shield`, addShield) ou d'un statut qui porte sa propre réserve dans
 * `data.shield` (Mana Barrier de Blitzcrank, dont l'absorption est un modifier) : les deux
 * se lisent pareil sur la carte -- chiffre, segment de barre et halo.
 */
export function characterVitals(char: CharacterInstance) {
  const currentHP = Math.max(0, char.currentMaxHP - char.damage);
  const shieldTotal =
    char.shield + char.statuses.reduce((sum, st) => sum + Math.max(0, Number(st.data?.['shield'] ?? 0)), 0);
  const ratio = (value: number) =>
    char.currentMaxHP > 0 ? Math.max(0, Math.min(100, (value / char.currentMaxHP) * 100)) : 0;
  // HP max rognés par un verrou de valeur (Mahito, Sang Maudit...) : jamais soignables,
  // donc une information à part entière -- « 120 / 150 » ne dit pas que ces 150 étaient 200.
  const lockedMaxHP = Math.max(0, char.baseMaxHP - char.currentMaxHP);
  return { currentHP, shieldTotal, lockedMaxHP, pct: ratio(currentHP), shieldPct: ratio(shieldTotal) };
}

/** Infobulle du verrou de valeur, partagée entre la ligne de PV et la pastille de l'actif. */
function lockedMaxHPHint(lockedMaxHP: number): string {
  return `HP max réduits de ${lockedMaxHP} (verrou de valeur : ces points ne se soignent pas)`;
}

/**
 * ATK du moment d'une attaque, en pastille : le chiffre, et une flèche qui dit le sens
 * pour qui ne distingue pas l'orange du rouge.
 */
function AtkReadout({ readout }: { readout: { id: string; name: string; base: number; effective: number } }) {
  const up = readout.effective > readout.base;
  return (
    <span
      className={`atk-text${up ? ' up' : ' down'}`}
      title={`${readout.name} : ${readout.effective} ATK (imprimé ${readout.base})`}
      aria-label={`${readout.name} : ${readout.effective} ATK, ${up ? 'en hausse' : 'en baisse'} (imprimé ${readout.base})`}
    >
      {' '}
      ⚔ {readout.effective}
      <span className="atk-arrow" aria-hidden="true">
        {up ? '▲' : '▼'}
      </span>
    </span>
  );
}

/**
 * Jauge de PV, jauge de bouclier et ligne chiffrée. Sorti de `CharacterCard` parce que le
 * banc les affiche SOUS la carte plutôt que dedans : à la taille d'une vignette de banc, le
 * bandeau d'infos ne laissait à la barre que quelques pixels de haut.
 */
export function CharacterVitals({ char, state }: { char: CharacterInstance; state?: GameState }) {
  const { currentHP, pct, shieldTotal, shieldPct, lockedMaxHP } = characterVitals(char);
  // Attaques dont l'ATK du moment n'est plus celui imprimé sur la carte : c'est le seul
  // endroit où le joueur peut lire le vrai chiffre sans ouvrir de fiche, et il n'apparaît
  // donc que quand il y a quelque chose à corriger.
  const shifted = (state ? attackReadouts(state, char) : []).filter((r) => r.effective !== r.base);
  const spoken = [
    `${currentHP} sur ${char.currentMaxHP} HP`,
    lockedMaxHP > 0 ? `HP max réduits de ${lockedMaxHP}` : '',
    shieldTotal > 0 ? `${shieldTotal} de bouclier` : '',
  ]
    .filter(Boolean)
    .join(', ');

  return (
    <>
      {/* Les deux jauges sont groupées pour que le banc puisse les poser à GAUCHE du
          chiffre au lieu de l'empiler dessus. Partout ailleurs, `.hp-gauges` est en
          `display: contents` : la boîte n'existe pas et rien ne bouge. */}
      <div className="hp-gauges">
        {/* Le dégradé de la jauge suit les PV en continu (vert plein ➔ ambre ➔ rouge) au
            lieu de sauter d'une couleur à l'autre à 50 % et 25 % : la teinte est calculée
            ici et lue par la CSS, qui garde le seuil pour le seul halo d'alerte. */}
        <div className="hp-bar" style={{ ['--hp-hue' as string]: Math.round(pct * 1.2) }}>
          <div className={`hp-bar-fill${pct <= 25 ? ' low' : ''}`} style={{ width: `${pct}%` }} />
        </div>
        {/* Barre de bouclier : une deuxième jauge, sous celle des PV, dans une autre
            couleur -- c'est ce qui sera mangé en premier par les dégâts. */}
        {shieldTotal > 0 && (
          <div className="shield-bar active" title={`${shieldTotal} points de bouclier`}>
            <div className="shield-bar-fill" style={{ width: `${shieldPct}%` }} />
          </div>
        )}
      </div>
      {/* Les PV actuels sont LE chiffre à lire : ils portent le poids, le plafond et
          l'unité passent en retrait. Sous 25 %, la ligne prend la couleur de l'alerte. */}
      <div className={`hp-text${pct <= 25 ? ' low' : ''}`} aria-label={spoken}>
        <span className="hp-cur">{currentHP}</span>
        <span className="hp-sep"> / </span>
        <span
          className={`hp-max${lockedMaxHP > 0 ? ' locked' : ''}`}
          title={lockedMaxHP > 0 ? lockedMaxHPHint(lockedMaxHP) : undefined}
        >
          {char.currentMaxHP}
          {lockedMaxHP > 0 && (
            <span className="hp-lock" aria-hidden="true">
              ▾
            </span>
          )}
        </span>
        <span className="hp-unit"> HP</span>
        {shieldTotal > 0 && (
          <span className="shield-text" title={`${shieldTotal} points de bouclier, encaissés avant les PV`}>
            {' '}
            +{shieldTotal} 🛡
          </span>
        )}
        {shifted.map((r) => (
          <AtkReadout key={r.id} readout={r} />
        ))}
      </div>
    </>
  );
}

/**
 * Texte flottant au-dessus de la carte à chaque modification de PV : rouge vif pour ce qui
 * est perdu, vert pour ce qui est rendu. Il est calculé sur les PV effectifs et non sur le
 * journal, ce qui lui fait couvrir *toutes* les sources sans en connaître aucune : coup
 * porté, tic de poison/brûlure/saignement, soin, verrou de valeur (Mahito) ou gain de HP
 * max. Ce que le bouclier absorbe ne bouge pas les PV, donc n'affiche rien -- c'est bien
 * ce qu'il faut lire.
 */
interface HpFloater {
  id: number;
  amount: number;
  kind: 'damage' | 'heal';
}

/** Motes de lumière qui montent sur un soin. Purement décoratif. */
const HEAL_MOTE_COUNT = 6;

/**
 * Les animations de `styles.css` qui portent la mise en scène d'un coup, et elles seules :
 * ce sont les seules qu'un nouvel impact doit relancer (voir plus bas). Une entrée manquante
 * ici ne casse rien -- elle rend juste ce temps-là muet sur un deuxième coup identique.
 */
const IMPACT_ANIMATIONS = new Set(['impact-lunge', 'impact-shake', 'impact-blast']);

export function CharacterCard({
  char,
  isActive,
  isKOable,
  size = 'normal',
  orientation = 'portrait',
  badges,
  onSelect,
  selected,
  targetable,
  targeted,
  onTarget,
  attachedObjects,
  state,
  commands,
  hideVitals,
  impact,
  facing,
  hideName,
}: {
  char: CharacterInstance;
  isActive: boolean;
  isKOable?: boolean;
  size?: 'small' | 'normal' | 'large';
  /** `landscape` pour le personnage actif : illustration à gauche, PV et statuts à droite. */
  orientation?: 'portrait' | 'landscape';
  badges?: CharacterBadge[];
  /** Remplace l'ouverture de la fiche par une action du plateau (le mini-menu d'un banc allié).
      L'aperçu au survol, lui, reste branché : la fiche complète est toujours lisible. */
  onSelect?: () => void;
  /** Marque la carte comme celle dont le mini-menu est ouvert. */
  selected?: boolean;
  /** Cible légale du ciblage en cours -- le clic vise au lieu d'ouvrir la fiche. */
  targetable?: boolean;
  /** Déjà retenue dans le ciblage en cours. */
  targeted?: boolean;
  onTarget?: () => void;
  /**
   * Objets liés à ce personnage, résolus par le plateau (`attachedObjectsOf`). Fournis =
   * les cartes sont dessinées ; absents = repli sur la ligne « N objet(s) attaché(s) »,
   * pour les surfaces qui n'ont pas l'état complet sous la main.
   */
  attachedObjects?: AttachedObjectView[];
  /**
   * L'état de la partie, quand la surface qui affiche la carte l'a sous la main (le
   * plateau). Il sert à lire l'ATK *réel* des attaques -- une carte à dégâts évolutifs
   * (Guts, Hulk, Mundo) affiche sinon la valeur imprimée, qui n'est plus la bonne. Absent
   * (cimetière, aperçu hors partie) : la carte se dessine sans ce chiffre.
   */
  state?: GameState;
  /**
   * Panneau d'actions logé dans la colonne d'infos de la carte (`size="large"` +
   * `orientation="landscape"` : le personnage actif du joueur). Le plateau y glisse le
   * `CommandPanel` -- attaquer, lancer une capacité, changer de personnage ou passer se
   * fait donc sur la carte elle-même, et plus dans une grille posée en dessous.
   * Absent partout ailleurs (banc, cimetière, aperçu), où la carte n'a rien à commander.
   */
  commands?: ReactNode;
  /**
   * Retire les jauges du bandeau d'infos : le banc les redessine SOUS la carte, où elles
   * ont la place d'être lues (`<CharacterVitals>`). Les statuts, eux, restent sur la carte.
   */
  hideVitals?: boolean;
  /** Coup en cours : la carte bondit (attaquant) ou encaisse (cible). */
  impact?: CharacterImpact;
  /**
   * Vers où la carte bondit quand elle attaque. Le plateau est un face-à-face gauche/droite :
   * seul l'appelant sait de quel côté se trouve l'ennemi. Sans lui, pas de dash -- une carte
   * de banc ou de cimetière n'a personne en face.
   */
  facing?: 'left' | 'right';
  /** Nom repris par un bandeau extérieur (le HUD de combat du personnage actif). */
  hideName?: boolean;
}) {
  const hover = useHoverCard();
  const { currentHP, pct, lockedMaxHP } = characterVitals(char);
  const dead = currentHP <= 0;
  const name = cardName(char.cardId);

  // A card's private bookkeeping statuses (Guts' damage record, Kakashi's memory of the
  // last enemy attack...) carry no information for the player and only crowd the card.
  const visibleStatuses = char.statuses.filter((s) => !s.hidden);

  const { shieldTotal } = characterVitals(char);

  // Attaques dont l'ATK du moment n'est plus celui imprimé sur la carte. Recalculé ici (et
  // pas seulement dans `<CharacterVitals>`) parce que la clé de rafraîchissement du panneau
  // épinglé, plus bas, doit le voir changer.
  const shiftedAttacks = (state ? attackReadouts(state, char) : []).filter((r) => r.effective !== r.base);

  const inspectPayload: HoverPayload = {
    id: char.instanceId,
    title: name,
    card: { cardId: char.cardId, kind: 'character', name },
    body: characterDetailBody(char.cardId, char, state),
  };
  const inspect = useCardInspect(inspectPayload);

  // Un panneau épinglé reste ouvert pendant que la partie avance : le rafraîchir dès que
  // l'instance qu'il montre change, sinon il affiche indéfiniment les PV et les statuts
  // qu'elle avait au moment du clic. La clé ne liste que ce que le panneau donne à lire,
  // pour ne pas relancer l'effet à chaque rendu.
  const liveKey = [
    char.cardId,
    char.currentMaxHP,
    char.damage,
    char.shield,
    char.attachedObjectInstanceIds.length,
    char.statuses
      .map(
        (s) =>
          `${s.statusId}:${s.remainingTurns ?? ''}:${String(s.data?.['stacks'] ?? '')}:${String(s.data?.['shield'] ?? '')}:${String(s.data?.['ticksRemaining'] ?? '')}`
      )
      .join(','),
    // Un bonus de dégâts cumulatif (Guts, Hulk) ne se lit ni dans les PV ni dans un statut
    // visible : sans lui, la fiche épinglée resterait sur l'ATK d'il y a trois tours.
    shiftedAttacks.map((r) => `${r.id}:${r.effective}`).join(','),
  ].join('|');
  useEffect(() => {
    hover.refreshPinned(inspectPayload);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveKey, hover]);

  // À côté sur le personnage actif (carte large, il y a la place) ; en pastille posée sur
  // le coin au banc, où une vignette accolée élargirait toute la colonne.
  const asideAttachments = size === 'large' ? (attachedObjects ?? []) : [];
  const chipAttachments = size === 'large' ? [] : (attachedObjects ?? []);

  // Quand les jauges sont parties dans un bandeau extérieur (le personnage actif), ce
  // bandeau ne dit que les PV et le bouclier : l'ATK du moment et le verrou de valeur
  // n'avaient plus aucun endroit où se lire sur le plateau. Ils reviennent en pastilles.
  const vitalChips = hideVitals ? { shifted: shiftedAttacks, lockedMaxHP } : null;
  const hasVitalChips = Boolean(vitalChips && (vitalChips.shifted.length > 0 || vitalChips.lockedMaxHP > 0));

  // Ce que la carte-bouton annonce au clavier / lecteur d'écran : le nom seul ne disait
  // ni si le personnage tenait debout, ni sous quels effets.
  const ariaLabel = [
    name,
    dead ? 'K.O.' : `${currentHP} sur ${char.currentMaxHP} HP`,
    shieldTotal > 0 ? `${shieldTotal} de bouclier` : '',
    visibleStatuses.length > 0 ? `statuts : ${visibleStatuses.map((s) => statusBadgeText(s)).join(', ')}` : '',
  ]
    .filter(Boolean)
    .join(', ');

  const prevHpRef = useRef(currentHP);
  const floaterSeqRef = useRef(0);
  const [flash, setFlash] = useState<'damage' | 'heal' | null>(null);
  const [floaters, setFloaters] = useState<HpFloater[]>([]);

  const timersRef = useRef<ReturnType<typeof setTimeout>[]>([]);
  useEffect(() => {
    const delta = currentHP - prevHpRef.current;
    prevHpRef.current = currentHP;
    if (delta === 0) return;

    const id = ++floaterSeqRef.current;
    const kind = delta < 0 ? 'damage' : 'heal';
    setFloaters((list) => [...list, { id, amount: Math.abs(delta), kind }]);
    setFlash(kind);
    // Timers are collected and cleared on unmount only. Clearing them in the effect's
    // own cleanup (i.e. on the *next* hit) cancelled the pending removal, so rapid
    // successive hits left their floaters stuck on the card forever.
    timersRef.current.push(
      setTimeout(() => setFlash(null), 400),
      setTimeout(() => setFloaters((list) => list.filter((f) => f.id !== id)), 1100)
    );
  }, [currentHP]);

  // La réserve de bouclier ne bouge pas les PV : rien ne se voyait quand elle se remplissait
  // ni quand elle volait en éclats. Détectée sur l'écart, comme les PV ci-dessus -- ce qui
  // couvre les deux sources (le bouclier natif du moteur et celui porté par un statut, cf.
  // `characterVitals`) sans avoir à en connaître aucune.
  const prevShieldRef = useRef(shieldTotal);
  const [shieldFx, setShieldFx] = useState<'gain' | 'break' | null>(null);
  useEffect(() => {
    const before = prevShieldRef.current;
    prevShieldRef.current = shieldTotal;
    if (shieldTotal === before) return;
    // Entamé sans être vidé : c'est l'éclat d'absorption joué sur le plateau qui le dit
    // (`shield-hit`), pas la carte -- sinon le moindre coup encaissé rejouait un bris.
    const kind = shieldTotal > before ? 'gain' : shieldTotal === 0 ? 'break' : null;
    if (!kind) return;
    setShieldFx(kind);
    timersRef.current.push(setTimeout(() => setShieldFx(null), 720));
  }, [shieldTotal]);

  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  // Le soin le plus récent encore à l'écran : sa clé fait rejouer la floraison à chaque
  // nouveau soin, là où un simple booléen aurait laissé le second passer sans rien montrer.
  const healFloater = floaters.filter((f) => f.kind === 'heal').at(-1);

  // Position relevée à chaque rendu : quand ce personnage tombera, sa carte aura déjà été
  // démontée (le moteur l'envoie au cimetière dans le même état que le KO) et il n'y aura
  // plus rien à mesurer pour lancer son vol. Cf. `cardRects.ts`.
  const frameRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    trackCardRect(char.instanceId, frameRef.current);
  });

  // Une animation CSS ne rejoue pas parce que React a redessiné : deux coups du même palier
  // coup sur coup posent exactement les mêmes classes, et le second passait inaperçu (double
  // frappe, riposte, tic d'AoE). Relancer la scène de l'impact remet le compteur à zéro à
  // chaque nouveau coup, sans avoir à faire varier les classes.
  //
  // ⚠️ Nommément, et jamais « tout ce qui tourne sur le cadre » : les animations d'ARRIVÉE
  // au poste actif et l'ambiance des statuts vivent sur le même élément, et les relancer
  // faisait rejouer son entrée à la carte (donc disparaître puis reglisser) à chaque coup
  // encaissé.
  const impactId = impact?.id;
  useEffect(() => {
    if (impactId === undefined) return;
    for (const anim of frameRef.current?.getAnimations?.() ?? []) {
      if (!IMPACT_ANIMATIONS.has((anim as { animationName?: string }).animationName ?? '')) continue;
      anim.cancel();
      anim.play();
    }
  }, [impactId]);

  // Mise en scène du coup en cours + ambiance des statuts : deux jeux de classes posés sur
  // le CADRE, parce qu'ils déplacent la carte et filtrent son illustration -- ce qu'un
  // calque d'effet, dessiné par-dessus, ne peut pas faire.
  const frameClasses = [
    ...(impact
      ? [
          `impact-${impact.tier}`,
          // Le critique renchérit sur le palier au lieu de le remplacer : décharge dorée sur
          // la cible, chiffre flottant doré, sursaut plus sec.
          impact.critical ? 'impact-crit' : '',
          impact.role === 'target' ? 'impact-hit' : facing ? `impact-dash impact-dash-${facing}` : '',
        ].filter(Boolean)
      : []),
    ...statusAmbienceClasses(visibleStatuses),
  ].join(' ');

  const hasFooter =
    !hideVitals ||
    hasVitalChips ||
    visibleStatuses.length > 0 ||
    Boolean(commands) ||
    (!attachedObjects && char.attachedObjectInstanceIds.length > 0);

  const card = (
    <CardFrame
      cardId={char.cardId}
      kind="character"
      name={name}
      size={size}
      orientation={orientation}
      rootRef={frameRef}
      className={frameClasses || undefined}
      hideName={hideName}
      highlight={isActive || selected}
      selected={selected}
      dimmed={dead && isKOable}
      targetable={targetable}
      targeted={targeted}
      ariaLabel={ariaLabel}
      {...inspect}
      // Pendant un ciblage, le clic sert à viser : ni fiche de carte, ni mini-menu de
      // banc, qui recouvriraient le plateau au moment précis où il faut le lire.
      onClick={targetable ? onTarget : (onSelect ?? inspect.onClick)}
      effects={
        <>
          <StatusEffectLayers statuses={visibleStatuses} />
          {/* Éclat d'impact au centre de la carte touchée : griffure à partir du coup
              moyen, éclair rouge plein cadre sur un gros coup. */}
          {impact?.role === 'target' && impact.tier !== 'light' && (
            <div className={`fx-layer fx-impact fx-impact-${impact.tier}`}>
              <span className="fx-impact-slash" />
            </div>
          )}
          {/* Halo de bouclier : un liseré bleu sur tout le pourtour, distinct du calque
              du statut `fx-shield` (icône 🛡 d'un death-ward ou d'un renvoi) -- les deux
              se cumulent sans se confondre. */}
          {shieldTotal > 0 && <div className="fx-layer fx-shield-halo" />}
          {/* Sous 25 % : une lueur rouge qui monte du bas de la carte. La jauge le dit
              déjà, mais elle est petite (banc) ou absente (actif) -- ici ça se voit de loin. */}
          {!dead && pct <= 25 && <div className="fx-layer fx-low-hp" />}
          {/* Tampon K.O. : une carte éteinte pouvait aussi bien être « en retrait » pendant
              un ciblage. Le mot lève le doute, au cimetière comme sur un banc. */}
          {dead && (
            <div className="fx-layer fx-ko-stamp" aria-hidden="true">
              <span>K.O.</span>
            </div>
          )}
          {/* Bouclier posé (bulle qui se referme) ou brisé (éclats qui partent) : deux temps
              que rien ne signalait, faute de mouvement sur la barre de PV. */}
          {shieldFx && <div className={`fx-layer fx-shield-${shieldFx}`} />}
          {chipAttachments.length > 0 && <AttachedObjectChips objects={chipAttachments} />}
          {badges && <CharacterActionBadges badges={badges} />}
          {flash && <div className={`fx-hp-flash fx-hp-flash-${flash}`} />}
          {/* Soin : des motes de lumière qui montent le long de la carte. Le voile vert seul
              se lisait comme un dégât d'une autre couleur -- ici le sens de lecture (ça
              monte) dit à lui seul qu'on rend de la vie. */}
          {healFloater && (
            <div className="fx-layer fx-heal-bloom" key={healFloater.id}>
              {Array.from({ length: HEAL_MOTE_COUNT }, (_, i) => (
                <span key={i} className="fx-heal-mote" style={{ ['--mote-i' as string]: i }} />
              ))}
            </div>
          )}
          {floaters.length > 0 && (
            <div className="fx-floaters">
              {/* Deux modifications coup sur coup (double tic de statut, riposte) se
                  décalent l'une au-dessus de l'autre au lieu de se superposer. */}
              {floaters.map((f, i) => (
                <span
                  key={f.id}
                  className={`fx-floater-number fx-floater-${f.kind}`}
                  style={{ ['--floater-i' as string]: i }}
                >
                  {f.kind === 'damage' ? '-' : '+'}
                  {f.amount}
                </span>
              ))}
            </div>
          )}
        </>
      }
      // Bandeau d'infos rendu SEULEMENT s'il a quelque chose à dire. Sur le portrait
      // actif, jauges et nom sont partis dans le HUD extérieur : sans ce test, il restait
      // une bande sombre vide sous l'illustration dès qu'aucun statut n'était posé.
      footer={
        hasFooter ? (
        <>
          {!hideVitals && <CharacterVitals char={char} state={state} />}
          {vitalChips && hasVitalChips && (
            <div className="vital-chips">
              {vitalChips.lockedMaxHP > 0 && (
                <span className="vital-chip vital-chip-lock" title={lockedMaxHPHint(vitalChips.lockedMaxHP)}>
                  HP max −{vitalChips.lockedMaxHP}
                </span>
              )}
              {vitalChips.shifted.map((r) => (
                <span key={r.id} className={`vital-chip vital-chip-atk${r.effective > r.base ? ' up' : ' down'}`}>
                  <span className="vital-chip-label">{r.name}</span>
                  <AtkReadout readout={r} />
                </span>
              ))}
            </div>
          )}
          {visibleStatuses.length > 0 && <StatusBadges statuses={visibleStatuses} compact={size === 'small'} />}
          {/* Repli : sans la liste résolue, au moins dire qu'il y a quelque chose. */}
          {!attachedObjects && char.attachedObjectInstanceIds.length > 0 && (
            <div className="attached-objects">{char.attachedObjectInstanceIds.length} objet(s) attaché(s)</div>
          )}
          {/* La carte entière est un bouton (fiche au clic) : sans cette coupure, chaque
              clic sur « Attaque » ou « Passer » ouvrirait la fiche par-dessus le plateau
              au moment même où l'action part. */}
          {commands && (
            <div
              className="card-commands"
              onClick={(e) => e.stopPropagation()}
              onKeyDown={(e) => e.stopPropagation()}
              // L'aperçu de la carte s'ouvre au survol du cadre : il recouvrirait les
              // boutons qu'on vient chercher. Entrer dans les commandes le referme (et
              // annule celui qui était en attente).
              onMouseEnter={hover.hide}
            >
              {commands}
            </div>
          )}
        </>
        ) : undefined
      }
    />
  );

  if (asideAttachments.length === 0) return card;
  // Le sens (objet à gauche ou à droite du personnage) est décidé en CSS par le camp :
  // l'objet se pose du côté extérieur, pour ne pas s'intercaler dans le face-à-face.
  return (
    <div className="char-with-attachments">
      {card}
      <AttachedObjectCards objects={asideAttachments} />
    </div>
  );
}
