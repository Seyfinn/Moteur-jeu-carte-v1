import type { ObjectCardDef } from '../types.js';
import { getLinkedPartnerId } from '../../statuses.js';
import { cardName } from '../../names.js';

export const jacobEtEssau: ObjectCardDef = {
  type: 'object',
  id: 'jacob-et-essau',
  name: 'Jacob et Essau',
  equipment: true, // reste en jeu accroché au premier des deux liés (ctx.attachSelfTo ci-dessous)
  description:
    'Lie 2 personnages. \n' +
    'Ces deux personnages attaquent désormais ensemble, appliquant leurs deux attaques. \n' +
    "Seul le personnage du poste actif peut utiliser son actif/passif.\n" +
    'Ces deux personnages subissent aussi des dégâts ensemble, si un des deux meurt, les deux meurent. ',
  unplayableReason(state, ownerId) {
    const player = state.players[ownerId];
    const ids = [player.activeCharacterInstanceId, ...player.benchCharacterInstanceIds].filter(
      (id): id is string => id !== null
    );
    // Un personnage déjà lié est exclu : le relier laisserait son ancien partenaire avec
    // un `partnerInstanceId` qui pointe vers quelqu'un qui ne lui répond plus, et le
    // moteur n'a pas de notion de chaîne à trois.
    const free = ids.filter((id) => {
      const char = player.characters[id];
      return !!char && !getLinkedPartnerId(char);
    });
    if (free.length < 2) {
      return 'Il faut 2 de vos personnages encore non liés pour former une paire.';
    }
    return null;
  },
  async execute(ctx) {
    const candidates = ctx.getAllOnBoard(ctx.ownerId).filter((c) => !getLinkedPartnerId(c));
    if (candidates.length < 2) return;

    const selected = await ctx.choose({
      kind: 'select-characters',
      prompt: 'Jacob et Essau : choisissez les 2 personnages à lier',
      options: candidates.map((c) => c.instanceId),
      min: 2,
      max: 2,
    });
    const [firstId, secondId] = selected;
    if (!firstId || !secondId || firstId === secondId) return;

    // L'objet reste en jeu accroché au premier des deux : c'est ce qui lui donne le logo
    // 🔗 et le fait dessiner à côté de son porteur. Il ne PORTE pas le lien pour autant --
    // celui-ci vit dans les deux statuts ci-dessous, parce qu'un objet ne peut pas réagir
    // aux événements (pas de champ `abilities` sur ObjectCardDef) et n'a donc aucun moyen
    // de défaire quoi que ce soit s'il quitte le jeu. Conséquence assumée : détruire
    // l'objet (terrain Destruction...) ne délie PAS la paire.
    ctx.attachSelfTo(firstId);

    const firstName = cardName(ctx.getCharacter(firstId).cardId);
    const secondName = cardName(ctx.getCharacter(secondId).cardId);

    // Statut générique du moteur ('linked', cf. types.ts) : la carte ne fait que poser la
    // paire, le moteur applique les quatre règles du lien (attaque jointe, dégâts
    // partagés, mort commune, capacités réservées à celui qui tient le poste actif).
    // Symétrique : chacun des deux pointe vers l'autre.
    ctx.applyStatus(firstId, {
      statusId: 'linked',
      label: `Lié à ${secondName}`,
      sourcePlayerId: ctx.ownerId,
      sourceCardInstanceId: ctx.sourceInstanceId,
      data: { partnerInstanceId: secondId },
    });
    ctx.applyStatus(secondId, {
      statusId: 'linked',
      label: `Lié à ${firstName}`,
      sourcePlayerId: ctx.ownerId,
      sourceCardInstanceId: ctx.sourceInstanceId,
      data: { partnerInstanceId: firstId },
    });

    ctx.log(`Jacob et Essau : ${firstName} et ${secondName} sont désormais liés`, {
      characterInstanceId: firstId,
      partnerInstanceId: secondId,
    });
  },
};
