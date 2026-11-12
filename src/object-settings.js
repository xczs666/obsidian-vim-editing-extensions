import { SEPARATORS } from './objects.js';

export const GROUPS = {
  separators: 'Separator text objects', line: 'Line text objects', subword: 'Subword text objects',
  brackets: 'Bracket aliases and double brackets', indentation: 'Indentation text objects',
  keyValue: 'Single-line keys and values', arguments: 'Arguments and function calls', custom: 'Custom boundary prompts', tables: 'Markdown table selection and yank',
};
export const OPTIONAL = { url: 'URL object (L)', whitespace: 'Whitespace variants (I/A)', buffer: 'Entire document (gG)' };
export const DEFAULT_SETTINGS = { groups: Object.fromEntries(Object.keys(GROUPS).map(k => [k, true])), navigation: true, url: false, whitespace: false, buffer: false, prefixTimeoutMs: 0, bindings: {} };
export const OBJECTS = [
  ...SEPARATORS.map(ch => ({ id: 'sep:' + ch, trigger: ch, group: 'separators', whitespace: true, label: `Separator ${ch === ' ' ? '<Space>' : ch}` })),
  ...[
    ['L', 'line', 'Current line'], ['S', 'subword', 'Subword'], ['D', 'brackets', 'Double brackets'], ['o', 'brackets', 'Automatic brackets'],
    ['i', 'indentation', 'Indentation'], ['I', 'indentation', 'Indentation with lower border'], ['g', 'indentation', 'Greedy indentation'],
    ['k', 'keyValue', 'Key'], ['v', 'keyValue', 'Value'], ['a', 'arguments', 'Argument'], ['f', 'arguments', 'Function call'], ['?', 'custom', 'Custom boundaries'], ['T', 'tables', 'Markdown table'],
  ].map(([id, group, label]) => ({ id, group, label, trigger: id, whitespace: ['D', 'o', '?'].includes(id) })),
];

export function normalizeSettings(input = {}) {
  input ??= {};
  const bindings = { ...input.bindings };
  // Preserve older custom identifiers when the newly introduced default T is
  // already in use. The table object can then be assigned another identifier.
  if (!Object.hasOwn(bindings, 'T') && Object.values(bindings).includes('T')) bindings.T = '';
  return { ...DEFAULT_SETTINGS, ...input, groups: { ...DEFAULT_SETTINGS.groups, ...input.groups }, bindings };
}

export function objectMappings(input) {
  const settings = normalizeSettings(input), result = [], used = new Set();
  if (!Number.isInteger(settings.prefixTimeoutMs) || settings.prefixTimeoutMs < 0 || settings.prefixTimeoutMs > 60000) {
    throw new Error('Prefix timeout must be an integer from 0 to 60000 ms (0 means unlimited).');
  }
  const descriptors = [
    { id: 'q', trigger: 'q', whitespace: true }, { id: 'b', trigger: 'b', whitespace: true },
    ...OBJECTS.map(o => ({ ...o, trigger: settings.bindings[o.id] ?? o.trigger, disabled: !settings.groups[o.group] })),
    ...['(', ')', '[', ']', '{', '}', '<', '>', '"', "'", '`', 't', 'B'].map(ch => ({ id: 'pair:' + ch, trigger: ch, whitespace: true, native: true })),
  ];
  for (const item of descriptors) {
    if (!item.trigger) continue;
    const trigger = item.trigger === '<Space>' ? ' ' : item.trigger;
    if ([...trigger].length !== 1 || /[\r\n]/.test(trigger) || (!item.native && ['n', 'l', 'w', 'W', 's', 'p', 't', 'B', '#', '(', ')', '[', ']', '{', '}', '<', '>', '"', "'", '`'].includes(trigger))) {
      throw new Error(`Invalid or reserved text-object identifier: ${item.label ?? item.id}`);
    }
    if (used.has(trigger)) throw new Error(`Duplicate text-object identifier: ${trigger}`);
    used.add(trigger);
    // Tables have a dedicated outer-document selection/yank bridge. Their
    // identifiers still participate in the same collision validation.
    if (item.id === 'T') continue;
    if (item.disabled) continue;
    const variants = ['i', 'a', ...(settings.whitespace && item.whitespace ? ['I', 'A'] : [])];
    for (const variant of variants) for (const [modifier, direction] of [['', 'current'], ...(settings.navigation ? [['n', 'next'], ['l', 'previous']] : [])]) {
      if (item.native && !modifier && (variant === 'i' || variant === 'a')) continue;
      result.push({ keys: variant + modifier + (trigger === ' ' ? '<Space>' : trigger), id: item.id, variant, direction });
      // Direct V.handleKey callers may provide a literal space instead.
      if (trigger === ' ') result.push({ keys: variant + modifier + ' ', id: item.id, variant, direction });
    }
  }
  if (settings.url) result.push({ keys: 'L', id: 'url', variant: 'a', direction: 'current' });
  if (settings.buffer) result.push({ keys: 'gG', id: 'buffer', variant: 'a', direction: 'current' });
  return result;
}
