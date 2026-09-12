import { useEffect, useRef, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import {
  BASE_CRITICAL_CHANCE_PERCENT,
  BASE_EVASION_CHANCE_PERCENT,
  CRITICAL_STATUS_CHANCE_PERCENT,
  DECK_LIMITS,
  DEFAULT_MAX_OBJECTS_PER_TURN,
  DEFAULT_MAX_TERRAINS_PER_TURN,
  DRAW_MODE_ELIMINATIONS_TO_WIN,
  DRAW_MODE_STARTING_CHARACTERS,
  EVASIVE_STATUS_CHANCE_PERCENT,
  RANDOM_POOL_SIZE,
  RECYCLE_OBJECT_COST,
  VULNERABLE_DAMAGE_BONUS_PERCENT,
} from 'engine';

/**
 * Guide du nouveau joueur, ouvert depuis le lobby (le tout premier écran, avant toute
 * partie). Il explique le jeu de bout en bout : le deck, le plateau, un tour, les KO, les
 * états. Le glossaire en partie (`EffectsGlossary.tsx`) reste la référence détaillée des
 * effets ; ici on ne fait que les nommer.
 *
 * Comme pour le glossaire, chaque nombre affiché vient d'une constante du moteur : un
 * rééquilibrage ne doit jamais laisser ce texte mentir au joueur.
 */
interface GuideSection {
  id: string;
  icon: string;
  title: string;
  body: ReactNode;
}

const SECTIONS: GuideSection[] = [
  {
    id: 'but',
    icon: '🎯',
    title: 'Le but du jeu',
    body: (
      <>
        <p>
          Un duel de cartes en 1 contre 1. Chaque joueur dirige une équipe de <strong>personnages</strong>,
          épaulée par des <strong>objets</strong> et des <strong>terrains</strong>.
        </p>
        <p>
          Le but : <strong>mettre KO tous les personnages adverses</strong>. Tant qu'il en reste un debout
          dans chaque camp, la partie continue.
        </p>
      </>
    ),
  },
  {
    id: 'deck',
    icon: '🃏',
    title: 'Votre deck',
    body: (
      <>
        <p>
          Un deck se compose de <strong>{DECK_LIMITS.character} personnages</strong>,{' '}
          <strong>{DECK_LIMITS.object} objets</strong> et <strong>{DECK_LIMITS.terrain} terrains</strong>. Chaque
          personnage et chaque terrain est unique ; un objet peut aller jusqu'à {DECK_LIMITS.maxCopiesPerCard}{' '}
          exemplaires, sauf s'il est marqué « unique ». Certaines cartes sont incompatibles entre elles : le
          deck-builder vous les grise automatiquement.
        </p>
        <p>
          Pas envie de construire un deck ? Un deck de départ est fourni. Vous pouvez aussi jouer en{' '}
          <strong>Mode Aléatoire</strong> (chacun compose son équipe dans un tirage de {RANDOM_POOL_SIZE.character}/
          {RANDOM_POOL_SIZE.object}/{RANDOM_POOL_SIZE.terrain} cartes) ou en <strong>Mode Pioche</strong> (
          {DRAW_MODE_STARTING_CHARACTERS} personnages au départ, une carte piochée par tour, le premier à{' '}
          {DRAW_MODE_ELIMINATIONS_TO_WIN} éliminations gagne).
        </p>
      </>
    ),
  },
  {
    id: 'plateau',
    icon: '🗺️',
    title: 'Le plateau',
    body: (
      <>
        <p>Chaque camp a :</p>
        <ul>
          <li>
            <strong>un personnage actif</strong>, en première ligne : c'est lui qui attaque et qui encaisse les
            coups ;
          </li>
          <li>
            <strong>un banc</strong>, où attendent les autres personnages ;
          </li>
          <li>
            <strong>une main</strong> d'objets et de terrains, cachée à l'adversaire ;
          </li>
          <li>
            <strong>un cimetière</strong> pour les cartes éliminées.
          </li>
        </ul>
        <p>
          Au centre, <strong>un seul terrain</strong> est en jeu à la fois. Poser un terrain par-dessus l'ancien le
          remplace.
        </p>
      </>
    ),
  },
  {
    id: 'tour',
    icon: '🔁',
    title: 'Le déroulement d’un tour',
    body: (
      <>
        <p>
          Au début, une pièce désigne qui commence, puis chacun choisit son personnage actif de départ. Les autres
          vont au banc.
        </p>
        <p>
          Pendant votre tour, vous pouvez enchaîner plusieurs actions gratuites, puis une action qui{' '}
          <strong>termine le tour</strong> :
        </p>
        <ul>
          <li>
            <strong>Attaquer</strong> avec votre actif. Chaque personnage a une ou plusieurs attaques, avec une valeur
            de dégâts et parfois un effet. Attaquer termine votre tour.
          </li>
          <li>
            <strong>Utiliser une capacité.</strong> La plupart des capacités actives sont gratuites et ne terminent
            pas le tour (sauf quand le texte le précise). Elles sont limitées, souvent à une fois par tour, parfois
            à une fois par partie.
          </li>
          <li>
            <strong>Jouer un objet</strong> : jusqu'à {DEFAULT_MAX_OBJECTS_PER_TURN} par tour. Le premier est
            gratuit, le dernier termine votre tour. Un objet « à lier » (icône 🔗) s'équipe sur un personnage et
            reste en jeu avec lui.
          </li>
          <li>
            <strong>Poser un terrain</strong> : {DEFAULT_MAX_TERRAINS_PER_TURN} par tour. Le terrain modifie les
            règles pour les deux camps tant qu'il est là (certains ont une durée limitée).
          </li>
          <li>
            <strong>Changer d'actif</strong> : envoyer votre actif au banc et faire monter un autre personnage. Cela
            termine votre tour.
          </li>
          <li>
            <strong>Recycler</strong> : donnez {RECYCLE_OBJECT_COST} objets de votre main pour en piocher 1 au hasard
            dans votre réserve. Gratuit, illimité, ne termine pas le tour.
          </li>
        </ul>
        <p>Vous pouvez aussi simplement passer votre tour.</p>
      </>
    ),
  },
  {
    id: 'hp',
    icon: '❤️',
    title: 'Points de vie et KO',
    body: (
      <>
        <p>
          Chaque personnage a des <strong>HP</strong>. Quand ils tombent à 0, il est <strong>KO</strong> et part au
          cimetière avec ses objets équipés. Si c'était votre actif, vous devez immédiatement le remplacer par un
          personnage du banc. Plus personne au banc ? Vous avez perdu.
        </p>
        <ul>
          <li>
            <strong>Bouclier</strong> : absorbe des dégâts avant les HP.
          </li>
          <li>
            <strong>Soin</strong> : rend des HP, sans dépasser le maximum.
          </li>
          <li>
            <strong>Valeur Lock</strong> : réduit les HP <em>maximum</em>. Ces dégâts ne se soignent jamais.
          </li>
          <li>
            <strong>Esquive</strong> et <strong>Critique</strong> : chaque coup a de base{' '}
            {BASE_EVASION_CHANCE_PERCENT}% de chance d'être esquivé et {BASE_CRITICAL_CHANCE_PERCENT}% d'être
            critique. Certaines cartes montent ces chances (« Esquive » = {EVASIVE_STATUS_CHANCE_PERCENT}%, « peut
            crit » = {CRITICAL_STATUS_CHANCE_PERCENT}%). Une roue tourne à l'écran pour chaque jet.
          </li>
        </ul>
      </>
    ),
  },
  {
    id: 'etats',
    icon: '☠',
    title: 'Les états',
    body: (
      <>
        <p>Les attaques et capacités posent souvent des états sur les personnages. Les plus courants :</p>
        <ul>
          <li>
            <strong>Poison</strong> / <strong>Brûlure</strong> : dégâts au début de chaque tour du porteur, même au
            banc.
          </li>
          <li>
            <strong>Saignement</strong> : s'accumule, puis explose d'un coup ; n'importe quel soin le retire.
          </li>
          <li>
            <strong>Vulnérable</strong> : +{VULNERABLE_DAMAGE_BONUS_PERCENT}% de dégâts subis.
          </li>
          <li>
            <strong>Étourdi</strong>, <strong>Désarmé</strong>, <strong>Silence</strong> : empêchent d'agir,
            d'attaquer ou d'utiliser ses capacités pendant quelques tours.
          </li>
          <li>
            <strong>Enchaîné</strong> : ne peut plus quitter le poste actif.
          </li>
        </ul>
        <p>
          Les durées se comptent en tours du porteur. Un personnage envoyé au banc voit la plupart de ses états{' '}
          <strong>mis en pause</strong> — seuls poison, brûlure et saignement continuent de faire mal. Le bouton{' '}
          <strong>📖 Effets</strong>, en partie, détaille chacun d'eux.
        </p>
      </>
    ),
  },
  {
    id: 'cartes',
    icon: '📜',
    title: 'Les cartes et le journal',
    body: (
      <>
        <p>
          Toutes les actions s'affichent dans le <strong>journal</strong>, sur le côté du plateau. Cliquez sur
          n'importe quelle carte pour lire son texte complet. <strong>Le texte de la carte fait foi</strong> : si une
          carte dit qu'elle peut faire quelque chose d'interdit d'habitude, elle le peut.
        </p>
        <p>
          Quand une carte vous pose une question (une cible, oui/non, un ordre), une fenêtre s'ouvre. Sans réponse
          de votre part avant la fin du compte à rebours, le jeu choisit pour vous.
        </p>
      </>
    ),
  },
  {
    id: 'conseils',
    icon: '💡',
    title: 'Conseils pour débuter',
    body: (
      <ol>
        <li>
          <strong>Ne gaspillez pas votre premier tour</strong> : posez un terrain ou un objet gratuit avant
          d'attaquer.
        </li>
        <li>
          <strong>Gérez votre banc</strong> : un changement d'actif coûte le tour, mais sauver un personnage à 20 HP
          vaut souvent le coup.
        </li>
        <li>
          <strong>Lisez les passifs adverses</strong> : beaucoup de personnages réagissent à un coup reçu, à un KO ou
          à un changement d'actif.
        </li>
        <li>
          <strong>Les états gagnent des parties</strong> : un poison ou un saignement bien placé finit le travail
          pendant que vous vous protégez.
        </li>
      </ol>
    ),
  },
];

function HowToPlayPanel({ onClose }: { onClose: () => void }) {
  const closeRef = useRef<HTMLButtonElement>(null);

  // Échap ferme le guide, comme les autres panneaux.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  // Le focus entre dans le panneau à l'ouverture et revient sur le bouton d'origine à la
  // fermeture, pour qu'un joueur au clavier ne retombe pas sur `body`.
  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeRef.current?.focus({ preventScroll: true });
    return () => opener?.focus?.({ preventScroll: true });
  }, []);

  const jumpTo = (id: string) => {
    document.getElementById(`howto-${id}`)?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  };

  // Portail vers `document.body`, comme le glossaire : le lobby empile ses propres calques
  // (fond animé, panneaux de verre) et un `position: fixed` posé dedans n'est pas garanti
  // de couvrir l'écran entier.
  return createPortal(
    <div className="modal-backdrop glossary-backdrop" onClick={onClose}>
      <div
        className="modal glossary-panel howto-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="howto-title"
        onClick={(e) => e.stopPropagation()}
      >
        <header className="glossary-header">
          <h3 id="howto-title">Comment jouer</h3>
          <button
            ref={closeRef}
            className="hover-card-close"
            onClick={onClose}
            aria-label="Fermer le guide (Échap)"
            title="Fermer (Échap)"
          >
            ×
          </button>
          <nav className="glossary-toc" aria-label="Sommaire du guide">
            {SECTIONS.map((section) => (
              <button key={section.id} className="glossary-toc-chip" onClick={() => jumpTo(section.id)}>
                <span aria-hidden="true">{section.icon}</span> {section.title}
              </button>
            ))}
          </nav>
        </header>

        <div className="glossary-scroll howto-scroll">
          {SECTIONS.map((section) => (
            <section key={section.id} id={`howto-${section.id}`} className="howto-section">
              <h4>
                <span aria-hidden="true">{section.icon}</span> {section.title}
              </h4>
              {section.body}
            </section>
          ))}
          <p className="howto-outro">Bonne partie !</p>
        </div>
      </div>
    </div>,
    document.body
  );
}

/** Le bouton du lobby + le guide qu'il ouvre. */
export function HowToPlayButton({ className }: { className?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button
        type="button"
        className={className ?? 'howto-button'}
        onClick={() => setOpen(true)}
        title="Les règles du jeu, expliquées pour un nouveau joueur"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        ❓ Comment jouer
      </button>
      {open && <HowToPlayPanel onClose={() => setOpen(false)} />}
    </>
  );
}
