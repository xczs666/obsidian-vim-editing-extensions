import { tableAt } from './tables.js';

/** A table selection belongs to the outer document, never to a cell's Vim
 * selection. Obsidian may replace/refocus cell editors between physical keys. */
export function tableCommands(V, { settings, context, paint = () => {}, notify = () => {} }) {
  let selected = null, registerPrefix = false;
  const trigger = settings.bindings.T ?? 'T';
  const enabled = settings.groups.tables && trigger;
  function cancel() {
    const previous = selected;
    selected = null; registerPrefix = false;
    if (previous) {
      paint(previous.root, null);
      if (previous.root.state.vim?.visualMode && previous.root.cm6?.dom.isConnected !== false) clear(previous.root);
    }
  }
  function valid(c) {
    return selected && c?.root === selected.root && c.root.getValue() === selected.text &&
      (!selected.doc || c.root.cm6?.state.doc === selected.doc) &&
      c.at >= selected.from && c.at <= selected.to;
  }
  function clear(cm) { V.handleKey(cm, '<Esc>', 'vim-editing-extensions'); }
  function yank(cm, range, register) {
    const text = range.root.getValue().slice(range.from, range.to);
    cancel();
    clear(cm);
    // Use the same writer as Vim's native yank: named/append/black-hole
    // registers and the host's clipboard synchronization retain their meaning.
    V.getRegisterController().pushText(register, 'yank', text, true, false);
  }
  return {
    cancel,
    hasSelection: cm => !!selected && context(cm)?.root === selected.root,
    findKey(cm, key) {
      if (!enabled) return null;
      const vim = cm.state.vim, input = vim?.inputState;
      if (!vim) return null;
      const c = context(cm);
      if (selected) {
        if (!valid(c) || vim.insertMode) cancel();
        else {
          if (key === '"') { registerPrefix = true; return null; }
          if (registerPrefix) { registerPrefix = false; return null; }
          if (key === 'y') {
            const range = selected, register = input.registerName;
            return { handler: () => { yank(cm, range, register); return true; } };
          }
          cancel();
          if (['d', 'c', 'r', 'x', 's', '>', '<', '=', 'g', '.', 'p', 'P'].includes(key)) {
            return { handler: () => { clear(cm); notify('Vim Editing Extensions: table objects support selection and yank only.'); return true; } };
          }
        }
      }
      if (!c || key !== trigger || vim.insertMode || !/^\d*[ia]$/.test(input.keyBuffer.join('')) || (!vim.visualMode && !input.operator)) return null;
      const register = input.registerName, variant = input.keyBuffer.at(-1);
      const copy = input.operator === 'yank';
      const supported = !vim.visualBlock && cm.listSelections().length === 1 &&
        (copy || (!input.operator && vim.visualMode)) && (input.getRepeat() || 1) === 1;
      const range = supported && tableAt(c.root.getValue(), c.at, variant);
      return { handler: () => {
        if (!range) {
          clear(cm);
          notify(supported ? 'Vim Editing Extensions: no Markdown table at the cursor.' : 'Vim Editing Extensions: table objects support one table, selection and yank only.');
          return true;
        }
        const prepared = { ...range, root: c.root, text: c.root.getValue(), doc: c.root.cm6?.state.doc };
        if (copy) yank(cm, prepared, register);
        else {
          clear(cm);
          selected = prepared;
          paint(c.root, range);
          notify('Table selected. Press y to copy or Esc to cancel.');
        }
        return true;
      } };
    },
  };
}
