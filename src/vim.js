import { DELIMITERS, TARGETS, findPair, tagPair, editPair, wrapRange, visualPair } from './pairs.js';

const NAME = 'vimEditingExtensions';
const ADD = '<VEEAdd>';
const COMMIT = '<VEECommit>';

const copyPos = p => ({ line: p.line, ch: p.ch });
function previousCharacter(text, end) {
  if (end <= 0) return 0;
  const low = text.charCodeAt(end - 1);
  return end - (low >= 0xDC00 && low <= 0xDFFF && end > 1 ? 2 : 1);
}

/** Extend one existing Vim instance; never install a second Vim key handler. */
export function installVimExtensions(V, options) {
  for (const method of ['defineMotion', 'defineAction', 'defineOperator', 'mapCommand', 'unmap', 'findKey', 'handleKey', 'getVimGlobalState_']) {
    if (typeof V?.[method] !== 'function') throw new Error(`Unsupported Vim runtime: ${method} is unavailable`);
  }
  let enabled = true;
  const bindings = [];
  const sessions = new Map();
  const staged = new WeakMap();
  const notify = options.notify ?? (() => {});
  const isCurrent = options.isCurrent ?? (() => true);

  // Built-in `s` is a complete substitution command and otherwise wins over
  // every multi-key `sa/sd/sr` prefix. Defer its dispatch while enabled without
  // deleting the original keymap (including any user's custom single-s map).
  const originalFindKey = V.findKey;
  function findKey(cm, key, origin) {
    const vim = cm.state.vim;
    const input = vim?.inputState;
    if (enabled && key === 's' && vim && !vim.insertMode && !input?.operator &&
        /^\d*$/.test(input?.keyBuffer.join('') ?? '') && isCurrent(cm)) {
      input.keyBuffer.push(key);
      return () => true;
    }
    return originalFindKey.call(this, cm, key, origin);
  }
  V.findKey = findKey;

  function bind(keys, type, name, args = {}, extra = {}) {
    V.mapCommand(keys, type, NAME + name, args, extra);
    bindings.push([keys, extra.context]);
  }
  function supported(cm) {
    if (!enabled || !isCurrent(cm)) return false;
    if (cm.state.vim?.visualBlock || cm.listSelections().length !== 1) {
      notify('Vim Editing Extensions: block selections and multiple cursors are not supported.');
      return false;
    }
    return true;
  }
  function snapshot(cm) {
    const vim = cm.state.vim;
    const macro = V.getVimGlobalState_().macroModeState;
    return {
      lastEditInputState: vim.lastEditInputState,
      lastEditActionCommand: vim.lastEditActionCommand,
      insertChanges: { ...macro.lastInsertModeChanges, changes: [...macro.lastInsertModeChanges.changes] },
      selections: cm.listSelections().map(r => ({ anchor: copyPos(r.anchor), head: copyPos(r.head) })),
      visualMode: vim.visualMode, visualLine: vim.visualLine,
      sel: vim.sel && { anchor: copyPos(vim.sel.anchor), head: copyPos(vim.sel.head) },
    };
  }
  function restoreEdit(cm, saved) {
    Object.assign(cm.state.vim, {
      lastEditInputState: saved.lastEditInputState,
      lastEditActionCommand: saved.lastEditActionCommand,
    });
    V.getVimGlobalState_().macroModeState.lastInsertModeChanges = saved.insertChanges;
  }
  function cancel(cm, restoreSelection = true) {
    const s = sessions.get(cm);
    if (!s) return;
    sessions.delete(cm);
    s.close?.();
    restoreEdit(cm, s.saved);
    if (restoreSelection && cm.getValue() === s.text && isCurrent(cm)) {
      cm.operation(() => {
        if (cm.curOp) cm.curOp.isVimOp = true;
        cm.setSelections(s.saved.selections);
        Object.assign(cm.state.vim, { visualMode: s.saved.visualMode, visualLine: s.saved.visualLine });
        if (s.saved.sel) cm.state.vim.sel = s.saved.sel;
      });
    }
  }
  function valid(cm, s) {
    return enabled && isCurrent(cm) && cm.getValue() === s.text &&
      (!s.doc || s.doc === cm.cm6?.state.doc);
  }
  function begin(cm, fields) {
    cancel(cm);
    const s = { ...fields, saved: snapshot(cm), text: cm.getValue(), doc: cm.cm6?.state.doc };
    sessions.set(cm, s);
    return s;
  }
  function apply(cm, edit) {
    if (!edit) return false;
    options.applyEdit(cm, edit);
    return true;
  }

  function objectMotion(cm, head, args, vim) {
    if (!supported(cm)) return null;
    const text = cm.getValue();
    let start = cm.indexFromPos(head), end = start;
    let exclude = null;
    if (vim.visualMode) {
      const a = cm.indexFromPos(vim.sel.anchor), h = cm.indexFromPos(vim.sel.head);
      start = Math.min(a, h);
      end = Math.max(a, h) + (text.codePointAt(Math.max(a, h)) > 0xFFFF ? 2 : 1);
      const p = findPair(text, start, end, args.target);
      if (p && end - start > 1) {
        const from = args.inner ? p.innerStart : p.start;
        const to = args.inner ? p.innerEnd : p.end;
        if (start === from && end === to) exclude = p;
      }
    }
    const p = findPair(text, start, end, args.target, args.repeat || 1, exclude);
    if (!p) return null;
    const from = args.inner ? p.innerStart : p.start;
    const to = args.inner ? p.innerEnd : p.end;
    args.inclusive = false;
    return [cm.posFromIndex(from), cm.posFromIndex(vim.visualMode && to > from ? previousCharacter(text, to) : to)];
  }
  V.defineMotion(NAME + 'object', objectMotion);
  for (const target of ['q', 'b']) for (const [key, inner] of [['i', true], ['a', false]]) {
    for (const context of ['visual', 'operatorPending']) bind(key + target, 'motion', 'object', { target, inner }, { context });
  }

  function visualRange(cm) {
    const r = cm.listSelections()[0];
    let from = cm.indexFromPos(r.anchor), to = cm.indexFromPos(r.head);
    if (from > to) [from, to] = [to, from];
    if (cm.state.vim.visualLine) {
      const text = cm.getValue();
      from = text.lastIndexOf('\n', Math.max(0, from - 1)) + 1;
      const lineEnd = text.indexOf('\n', Math.max(from, to - 1));
      to = lineEnd < 0 ? text.length : lineEnd + 1;
    }
    return { from, to };
  }
  function operationEdit(cm, spec, count) {
    const text = cm.getValue();
    if (spec.visual) {
      const from = cm.indexFromPos(cm.getCursor());
      const to = Math.min(text.length, from + spec.width);
      if (spec.kind === 'add') return wrapRange(text, from, to, spec.pair, count, spec.linewise);
      return visualPair(text, from, to, count, spec.pair);
    }
    const at = cm.indexFromPos(cm.getCursor());
    const p = findPair(text, at, at, spec.target, count);
    if (!p) return null;
    return editPair(text, p, spec.pair);
  }
  function commitAction(cm, spec, edit) {
    const s = sessions.get(cm);
    if (s && !valid(cm, s)) { cancel(cm, false); return; }
    sessions.delete(cm);
    s?.close?.();
    if (cm.state.vim.visualMode) V.exitVisualMode(cm, false);
    staged.set(cm, { spec, edit });
    // Record only successful edits through Vim's own isEdit dispatch.
    V.handleKey(cm, COMMIT, 'vim-editing-extensions');
  }
  V.defineAction(NAME + 'commit', (cm, args, vim) => {
    if (!enabled) return;
    const prepared = staged.get(cm);
    staged.delete(cm);
    const spec = args.spec ?? prepared?.spec;
    if (!spec) return;
    const count = args.repeatIsExplicit ? args.repeat : spec.count;
    const edit = prepared?.edit ?? operationEdit(cm, spec, count);
    if (!edit || !apply(cm, edit)) return;
    // The mapping object is shared globally. Store a fresh replay command per editor.
    vim.lastEditActionCommand = {
      type: 'action', action: NAME + 'commit', isEdit: true, actionArgs: { spec },
    };
  });
  bind(COMMIT, 'action', 'commit', {}, { isEdit: true });

  function replacement(cm, s, onPair) {
    s.close = options.prompt(cm, {
      label: 'Surround with character (t: tag)', single: true,
      accept(value) {
        if (!valid(cm, s)) { cancel(cm, false); return; }
        if (value === 't' || value === 'T') {
          s.close = options.prompt(cm, {
            label: 'Tag name and attributes', single: false,
            accept(input) {
              const p = tagPair(input);
              if (!p) { notify('Vim Editing Extensions: invalid or self-closing tag.'); cancel(cm); return; }
              if (valid(cm, s)) onPair(p); else cancel(cm, false);
            },
            cancel: () => cancel(cm),
          });
        } else if (DELIMITERS[value]) onPair(DELIMITERS[value]);
        else cancel(cm);
      },
      cancel: () => cancel(cm),
    });
  }
  function startEdit(cm, args, kind, visual = false) {
    if (!supported(cm)) return;
    const count = args.repeat || 1;
    const text = cm.getValue();
    const range = visual ? visualRange(cm) : null;
    const p = visual ? null : findPair(text, cm.indexFromPos(cm.getCursor()), undefined, args.target, count);
    const test = visual ? visualPair(text, range.from, range.to, count) : p && editPair(text, p);
    if (!test) return;
    const spec = { kind, target: args.target, count, pair: ['', ''], visual, width: range && range.to - range.from };
    if (kind === 'delete') { commitAction(cm, spec, test); return; }
    const s = begin(cm, { range, spec });
    replacement(cm, s, pair => {
      const result = visual ? visualPair(text, range.from, range.to, count, pair) : editPair(text, p, pair);
      commitAction(cm, { ...spec, pair }, result);
    });
  }
  V.defineAction(NAME + 'delete', (cm, args) => startEdit(cm, args, 'delete'));
  V.defineAction(NAME + 'replace', (cm, args) => startEdit(cm, args, 'replace'));
  for (const target of TARGETS) {
    bind('sd' + target, 'action', 'delete', { target }, { context: 'normal' });
    bind('sr' + target, 'action', 'replace', { target }, { context: 'normal' });
  }
  V.defineAction(NAME + 'deleteVisual', (cm, args) => startEdit(cm, args, 'delete', true));
  V.defineAction(NAME + 'replaceVisual', (cm, args) => startEdit(cm, args, 'replace', true));
  bind('sd', 'action', 'deleteVisual', {}, { context: 'visual' });
  bind('sr', 'action', 'replaceVisual', {}, { context: 'visual' });

  V.defineAction(NAME + 'startAdd', (cm, args) => {
    if (!supported(cm)) return;
    begin(cm, { layers: args.repeat || 1 });
    V.handleKey(cm, ADD, 'vim-editing-extensions');
  });
  V.defineOperator(NAME + 'add', (cm, args, ranges) => {
    if (!supported(cm)) return;
    const r = ranges[0];
    let from = cm.indexFromPos(r.anchor), to = cm.indexFromPos(r.head);
    if (from > to) [from, to] = [to, from];
    if (args.pair) {
      apply(cm, wrapRange(cm.getValue(), from, to, args.pair, args.layers, args.linewise));
      return cm.posFromIndex(from);
    }
    const s = sessions.get(cm);
    if (!s || !valid(cm, s)) { cancel(cm, false); return; }
    const input = cm.state.vim.lastEditInputState;
    restoreEdit(cm, s.saved);
    replacement(cm, s, pair => {
      if (!valid(cm, s)) { cancel(cm, false); return; }
      sessions.delete(cm);
      s.close?.();
      args.pair = pair;
      args.layers = s.layers;
      if (input.operatorArgs) Object.assign(input.operatorArgs, { pair, layers: s.layers });
      apply(cm, wrapRange(s.text, from, to, pair, s.layers, args.linewise));
      cm.state.vim.lastEditInputState = input;
      cm.state.vim.lastEditActionCommand = undefined;
      V.getVimGlobalState_().macroModeState.lastInsertModeChanges.changes = [];
    });
    // evalInput exits visual mode after returning. Keep its cursor at the selection start.
    return cm.posFromIndex(from);
  });
  bind('sa', 'action', 'startAdd');
  bind(ADD, 'operator', 'add');

  return {
    cancelAll() { for (const cm of [...sessions.keys()]) cancel(cm, false); },
    hasPending: cm => sessions.has(cm),
    finishInput(cm, key) {
      // Called after a physical key, not during the engine's internal clearInputState.
      const s = sessions.get(cm);
      if (s && !s.close && (['<Esc>', '<C-c>', '<C-[>'].includes(key) || !cm.state.vim.inputState.operator)) cancel(cm);
    },
    uninstall() {
      for (const cm of [...sessions.keys()]) cancel(cm);
      enabled = false;
      for (const [key, context] of bindings.reverse()) V.unmap(key, context);
      if (V.findKey === findKey) V.findKey = originalFindKey;
      // Definitions have no undefine API; they remain inert, namespaced, and unbound.
    },
  };
}
