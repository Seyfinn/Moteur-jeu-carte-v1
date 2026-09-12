import type { ChoiceAnswer, ChoiceSpec } from './types.js';

/**
 * The answer the engine falls back to when nobody answers a prompt in time (the server
 * auto-resolves an abandoned choice rather than leaving the match frozen forever) --
 * always the least surprising, most neutral option: the first legal selection, "no",
 * or the order as presented. "No" rather than "yes" on a yes/no question (author's
 * decision): a silent player must never be committed to an optional effect -- a
 * sacrifice, a gamble, a self-inflicted cost -- that they never agreed to. Lives in the
 * engine so the server, the tests and any other driver all resolve a dropped prompt
 * identically.
 */
export function defaultChoiceAnswer(spec: ChoiceSpec): ChoiceAnswer {
  switch (spec.kind) {
    case 'select-characters':
      return { kind: 'select-characters', selected: spec.options.slice(0, Math.max(spec.min, 0)) };
    case 'select-option':
      return { kind: 'select-option', key: spec.options[0]?.key ?? '' };
    case 'yes-no':
      return { kind: 'yes-no', value: false };
    case 'order':
      return { kind: 'order', orderedKeys: spec.items.map((i) => i.key) };
  }
}
