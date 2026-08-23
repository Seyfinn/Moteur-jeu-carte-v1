import { Match, defaultChoiceAnswer, type ChoiceAnswer, type MatchConfig, type PendingChoice, type PlayerAction, type PlayerId } from '../src/index.js';

export type AutoAnswerFn = (choice: PendingChoice, match: Match) => ChoiceAnswer;

/** Same fallback the server uses when a prompt times out -- keeps tests honest about it. */
export function defaultAnswer(choice: PendingChoice): ChoiceAnswer {
  return defaultChoiceAnswer(choice.spec);
}

/** Drives a match through every pending choice (using `autoAnswer`, falling back to a sane default) until idle. */
export async function settle(match: Match, autoAnswer?: AutoAnswerFn): Promise<void> {
  await match.waitForNextPause();
  let guard = 0;
  while (match.state.pendingChoice) {
    if (++guard > 1000) throw new Error('settle(): too many pending choices, possible infinite loop');
    const choice = match.state.pendingChoice;
    const answer = autoAnswer ? autoAnswer(choice, match) : defaultAnswer(choice);
    const res = match.answerChoice(choice.playerId, choice.id, answer);
    if (!res.ok) throw new Error(`answerChoice rejected: ${res.error}`);
    await match.waitForNextPause();
  }
}

export async function drive(
  match: Match,
  playerId: PlayerId,
  action: PlayerAction,
  autoAnswer?: AutoAnswerFn
): Promise<void> {
  const result = match.applyAction(playerId, action);
  if (!result.ok) throw new Error(`Action rejected: ${result.error}`);
  await settle(match, autoAnswer);
}

export async function createReadyMatch(
  config: MatchConfig,
  opts?: { p1ActiveCardId?: string; p2ActiveCardId?: string }
): Promise<Match> {
  const match = Match.create(config);
  await settle(match, (choice) => {
    if (choice.spec.kind !== 'select-characters') return defaultAnswer(choice);
    const player = match.state.players[choice.playerId];
    const wantedCardId = choice.playerId === 'p1' ? opts?.p1ActiveCardId : opts?.p2ActiveCardId;
    let selected = choice.spec.options[0]!;
    if (wantedCardId) {
      const found = choice.spec.options.find((id) => player.characters[id]?.cardId === wantedCardId);
      if (found) selected = found;
    }
    return { kind: 'select-characters', selected: [selected] };
  });
  return match;
}

export function findInstance(match: Match, playerId: PlayerId, cardId: string): string {
  const player = match.state.players[playerId];
  const found = Object.values(player.characters).find((c) => c.cardId === cardId);
  if (!found) throw new Error(`No instance of "${cardId}" for ${playerId}`);
  return found.instanceId;
}
