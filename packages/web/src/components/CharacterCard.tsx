import { useEffect, useRef, useState } from 'react';
import { getCharacterCard, type CharacterInstance, type GameState, type StatusInstance } from 'engine';
import { CardFrame } from './CardFrame';
import { useCardInspect, useHoverCard, type HoverPayload } from './HoverCard';
import { characterDetailBody } from './cardDetails';
import { StatusEffectLayers, toneForStatus } from './statusEffects';
import { AttachedObjectCards, AttachedObjectChips } from './AttachedObjects';
import { attackReadouts, type AttachedObjectView } from './boardActions';
import { CharacterActionBadges } from './gameEventBadges';
import type { CharacterBadge } from './gameEvents';

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
}) {
  const hover = useHoverCard();
  const currentHP = Math.max(0, char.currentMaxHP - char.damage);
  const pct = char.currentMaxHP > 0 ? Math.max(0, Math.min(100, (currentHP / char.currentMaxHP) * 100)) : 0;
  const dead = currentHP <= 0;
  const name = cardName(char.cardId);

  // A card's private bookkeeping statuses (Guts' damage record, Kakashi's memory of the
  // last enemy attack...) carry no information for the player and only crowd the card.
  const visibleStatuses = char.statuses.filter((s) => !s.hidden);

  // Un bouclier peut venir du moteur (`char.shield`, addShield) ou d'un statut qui porte sa
  // propre réserve dans `data.shield` (Mana Barrier de Blitzcrank, dont l'absorption est un
  // modifier). Les deux se lisent pareil sur la carte : chiffre, segment de barre et halo.
  const shieldTotal =
    char.shield + char.statuses.reduce((sum, st) => sum + Math.max(0, Number(st.data?.['shield'] ?? 0)), 0);
  const shieldPct = char.currentMaxHP > 0 ? Math.max(0, Math.min(100, (shieldTotal / char.currentMaxHP) * 100)) : 0;

  // Attaques dont l'ATK du moment n'est plus celui imprimé sur la carte : c'est le seul
  // endroit où le joueur peut lire le vrai chiffre sans ouvrir de fiche, et il n'apparaît
  // donc que quand il y a quelque chose à corriger.
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

  const card = (
    <CardFrame
      cardId={char.cardId}
      kind="character"
      name={name}
      size={size}
      orientation={orientation}
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
          <StatusEffectLayers statusIds={visibleStatuses.map((s) => s.statusId)} />
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
          <div className="hp-bar">
            <div
              className={`hp-bar-fill${pct <= 25 ? ' low' : pct <= 50 ? ' mid' : ''}`}
              style={{ width: `${pct}%` }}
            />
          </div>
          {/* Barre de bouclier : une deuxième jauge, sous celle des PV, dans une autre
              couleur -- c'est ce qui sera mangé en premier par les dégâts. */}
          {shieldTotal > 0 && (
            <div className="shield-bar" title={`${shieldTotal} points de bouclier`}>
              <div className="shield-bar-fill" style={{ width: `${shieldPct}%` }} />
            </div>
          )}
          <div className="hp-text">
            {currentHP} / {char.currentMaxHP} HP
            {shieldTotal > 0 && <span className="shield-text"> +{shieldTotal} 🛡</span>}
            {shiftedAttacks.map((r) => (
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
