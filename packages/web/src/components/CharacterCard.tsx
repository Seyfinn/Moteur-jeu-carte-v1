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
 * Statuses carry a human `label` written by the card that applied them ("Brûlure (La
 * flamme)"); the raw `statusId` is an internal key and reads as noise on the board, so
 * it moves to the tooltip instead.
 */
export function statusBadgeText(status: StatusInstance): string {
  const name = status.label || status.statusId;
  // `data.shield` = réserve de bouclier portée par un statut (Mana Barrier de Blitzcrank).
  // Elle fond à chaque coup encaissé : sans le chiffre, le badge ne disait pas ce qu'il
  // reste à absorber.
  const shieldPool = Number(status.data?.['shield'] ?? 0);
  if (shieldPool > 0) return `${name} ${shieldPool} 🛡`;
  if (status.remainingTurns !== undefined) return `${name} (${status.remainingTurns})`;
  if (status.statusId === 'bleed') return `${name} x${Number(status.data?.['stacks'] ?? 1)}`;
  // « Tours compté » : pas de `remainingTurns` (décompte géré par le moteur en dehors du
  // tick générique, cf. turn.ts::resolveSurvivalVow) -- sans ça, le badge ne dirait pas
  // combien de tours il reste à tenir.
  if (status.statusId === 'survival-vow') return `${name} (${Number(status.data?.['ticksRemaining'] ?? 0)})`;
  return name;
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
  return { currentHP, shieldTotal, pct: ratio(currentHP), shieldPct: ratio(shieldTotal) };
}

/**
 * Jauge de PV, jauge de bouclier et ligne chiffrée. Sorti de `CharacterCard` parce que le
 * banc les affiche SOUS la carte plutôt que dedans : à la taille d'une vignette de banc, le
 * bandeau d'infos ne laissait à la barre que quelques pixels de haut.
 */
export function CharacterVitals({ char, state }: { char: CharacterInstance; state?: GameState }) {
  const { currentHP, pct, shieldTotal, shieldPct } = characterVitals(char);
  // Attaques dont l'ATK du moment n'est plus celui imprimé sur la carte : c'est le seul
  // endroit où le joueur peut lire le vrai chiffre sans ouvrir de fiche, et il n'apparaît
  // donc que quand il y a quelque chose à corriger.
  const shifted = (state ? attackReadouts(state, char) : []).filter((r) => r.effective !== r.base);

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
      <div className="hp-text">
        {currentHP} / {char.currentMaxHP} HP
        {shieldTotal > 0 && <span className="shield-text"> +{shieldTotal} 🛡</span>}
        {shifted.map((r) => (
          <span
            key={r.id}
            className={`atk-text${r.effective > r.base ? ' up' : ' down'}`}
            title={`${r.name} : ${r.effective} ATK (imprimé ${r.base})`}
          >
            {' '}
            ⚔ {r.effective}
          </span>
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
}) {
  const hover = useHoverCard();
  const { currentHP } = characterVitals(char);
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

  useEffect(() => () => timersRef.current.forEach(clearTimeout), []);

  // Position relevée à chaque rendu : quand ce personnage tombera, sa carte aura déjà été
  // démontée (le moteur l'envoie au cimetière dans le même état que le KO) et il n'y aura
  // plus rien à mesurer pour lancer son vol. Cf. `cardRects.ts`.
  const frameRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    trackCardRect(char.instanceId, frameRef.current);
  });

  // Mise en scène du coup en cours + ambiance des statuts : deux jeux de classes posés sur
  // le CADRE, parce qu'ils déplacent la carte et filtrent son illustration -- ce qu'un
  // calque d'effet, dessiné par-dessus, ne peut pas faire.
  const frameClasses = [
    ...(impact
      ? [
          `impact-${impact.tier}`,
          impact.role === 'target' ? 'impact-hit' : facing ? `impact-dash impact-dash-${facing}` : '',
        ].filter(Boolean)
      : []),
    ...statusAmbienceClasses(visibleStatuses),
  ].join(' ');

  const card = (
    <CardFrame
      cardId={char.cardId}
      kind="character"
      name={name}
      size={size}
      orientation={orientation}
      rootRef={frameRef}
      className={frameClasses || undefined}
      highlight={isActive || selected}
      dimmed={dead && isKOable}
      targetable={targetable}
      targeted={targeted}
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
          {shieldTotal > 0 && <div className="fx-layer fx-shield" />}
          {chipAttachments.length > 0 && <AttachedObjectChips objects={chipAttachments} />}
          {badges && <CharacterActionBadges badges={badges} />}
          {flash && <div className={`fx-hp-flash fx-hp-flash-${flash}`} />}
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
      footer={
        <>
          {!hideVitals && <CharacterVitals char={char} state={state} />}
          {visibleStatuses.length > 0 && (
            <div className="statuses">
              {visibleStatuses.map((s, i) => (
                <span
                  key={i}
                  className={`status-badge status-tone-${toneForStatus(s.statusId)}`}
                  title={`${s.label} (${s.statusId})`}
                >
                  {statusBadgeText(s)}
                </span>
              ))}
            </div>
          )}
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
