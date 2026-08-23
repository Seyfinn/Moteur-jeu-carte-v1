import type { ChoiceAnswer, ChoiceSpec } from './types.js';

/**
 * The answer the engine falls back to when nobody answers a prompt in time (the server
 * auto-resolves an abandoned choice rather than leaving the match frozen forever) --
 * always the least surprising, most neutral option: the first legal selection, "yes",
 * or the order as presented. Lives in the engine so the server, the tests and any other
 * driver all resolve a dropped prompt identically.
 */
export function defaultChoiceAnswer(spec: ChoiceSpec): ChoiceAnswer {
  switch (spec.kind) {
    case 'select-characters':
      return { kind: 'select-characters', selected: spec.options.slice(0, Math.max(spec.min, 0)) };
    case 'select-option':
      return { kind: 'select-option', key: spec.options[0]?.key ?? '' };
    case 'yes-no':
      return { kind: 'yes-no', value: true };
    case 'order':
      return { kind: 'order', orderedKeys: spec.items.map((i) => i.key) };
  }
}
