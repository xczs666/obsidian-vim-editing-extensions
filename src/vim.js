import { DELIMITERS, TARGETS, findPair, tagPair, editPair, wrapRange, visualPair } from './pairs.js';
import { registerEdit } from './registers.js';
import { resolveObject } from './objects.js';
import { objectMappings, normalizeSettings } from './object-settings.js';
import { cloneInput, prefixWait } from './prefixes.js';
import { tableCommands } from './table-commands.js';

const NAME = 'vimEditingExtensions';
const ADD = '<VEEAdd>';
const COMMIT = '<VEECommit>';
const REGISTER_REPLACE = NAME + 'registerReplace';
const OBJECT = '<VEEObject>';

const copyPos = p => ({ line: p.line, ch: p.ch });
function previousCharacter(text, end) {
  if (end <= 0) return 0;
  const low = text.charCodeAt(end - 1);
  return end - (low >= 0xDC00 && low <= 0xDFFF && end > 1 ? 2 : 1);
}

/** Extend one existing Vim instance; never install a second Vim key handler. */
export function installVimExtensions(V, options) {
  for (const method of ['defineMotion', 'defineAction', 'defineOperator', 'mapCommand', 'unmap', 'findKey', 'handleKey', 'getVimGlobalState_', 'getRegisterController']) {
    if (typeof V?.[method] !== 'function') throw new Error(`Unsupported Vim runtime: ${method} is unavailable`);
  }
  let enabled = true;
  const bindings = [];
  const sessions = new Map();
  const staged = new WeakMap();
  const registerContexts = new WeakMap();
  const frames = new WeakMap();
  const visualObjects = new WeakMap();
  const resolvedPrompts = new WeakMap();
  const settings = normalizeSettings(options.settings);
  const mappings = objectMappings(settings);
  const notify = options.notify ?? (() => {});
  const isCurrent = options.isCurrent ?? (() => true);

  // Built-in `s` is a complete substitution command and otherwise wins over
  // every multi-key `sa/sd/sr` prefix. Defer its dispatch while enabled without
  // deleting the original keymap (including any user's custom single-s map).
  const originalFindKey = V.findKey;
  const tables = tableCommands(V, {
    settings, notify,
    context: options.tableContext ?? (cm => isCurrent(cm) ? { root: cm, at: cm.indexFromPos(cm.getCursor()) } : null),
    paint: options.paintTable ?? ((cm, range) => { if (range) cm.setSelection(cm.posFromIndex(range.from), cm.posFromIndex(range.to)); }),
  });
  const prefixes = prefixWait({ lookup, timeoutMs: settings.prefixTimeoutMs, isCurrent, getEvent: options.getEvent });
  function findKey(cm, key, origin) {
    if (prefixes.forwarding) return;
    const table = tables.findKey(cm, key);
    if (table) return table.handler;
    const pending = prefixes.resolve(cm, key, origin);
    if (pending) return pending.handler;
    const vim = cm.state.vim;
    const input = vim?.inputState;
    if (vim && !vim.visualMode) visualObjects.delete(cm);
    if (enabled && key === 's' && vim && !vim.insertMode && !input?.operator &&
        /^\d*$/.test(input?.keyBuffer.join('') ?? '') && isCurrent(cm)) {
      return prefixes.defer(cm, key, origin);
    }
    if (enabled && settings.whitespace && ['I', 'A'].includes(key) && vim?.visualMode && !vim.visualBlock &&
        !input?.operator && /^\d*$/.test(input?.keyBuffer.join('') ?? '') && isCurrent(cm)) {
      return prefixes.defer(cm, key, origin);
    }
    // Native i<register>/a<register> are complete after two keys. Hold n/l
    // only where our three-key next/previous object mappings need a third key.
    if (enabled && settings.navigation && vim && !vim.insertMode && !vim.visualBlock && isCurrent(cm) &&
        ['n', 'l'].includes(key) && /^\d*[iaIA]$/.test(input?.keyBuffer.join('') ?? '')) {
      return prefixes.defer(cm, key, origin);
    }
    return lookup(cm, key, origin);
  }
  function lookup(cm, key, origin) {
    const vim = cm.state.vim;
    const input = vim?.inputState;
    // evalInput records an edit before it knows whether a motion/register can
    // produce an edit. Guard only our operator (including dot replay), so a
    // failed replacement cannot destroy the previous repeat or visual selection.
    const replacing = enabled && vim && !vim.insertMode && isCurrent(cm) && (
      input?.operator === REGISTER_REPLACE ||
      (!input?.operator && key === 'r' && /^\d*g$/.test(input?.keyBuffer.join('') ?? '')) ||
      (key === '.' && vim.lastEditInputState?.operator === REGISTER_REPLACE));
    const saved = enabled && vim && !vim.insertMode && isCurrent(cm) ? snapshot(cm) : null;
    const text = replacing ? cm.getValue() : null;
    const handler = originalFindKey.call(V, cm, key, origin);
    if (!saved || typeof handler !== 'function') return handler;
    return (...args) => {
      const parent = frames.get(cm);
      const frame = { saved, outcome: null };
      frames.set(cm, frame);
      if (replacing && input?.operator !== REGISTER_REPLACE) registerContexts.set(cm, { blocked: !supported(cm), saved, replay: key === '.' });
      try {
        const result = handler(...args);
        if (['failed', 'pending'].includes(frame.outcome) || (replacing && cm.getValue() === text)) {
          restoreEdit(cm, saved);
          restoreSelection(cm, saved);
        }
        if (replacing && cm.state.vim.inputState.operator !== REGISTER_REPLACE) registerContexts.delete(cm);
        return result;
      } finally {
        if (parent && frame.outcome) parent.outcome = frame.outcome;
        if (parent) frames.set(cm, parent); else frames.delete(cm);
      }
    };
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
      repeatOverride: vim.lastEditInputState?.repeatOverride,
      lastEditActionCommand: vim.lastEditActionCommand,
      insertChanges: { ...macro.lastInsertModeChanges, changes: [...macro.lastInsertModeChanges.changes] },
      selections: cm.listSelections().map(r => ({ anchor: copyPos(r.anchor), head: copyPos(r.head) })),
      visualMode: vim.visualMode, visualLine: vim.visualLine,
      sel: vim.sel && { anchor: copyPos(vim.sel.anchor), head: copyPos(vim.sel.head) },
    };
  }
  function restoreEdit(cm, saved) {
    if (saved.lastEditInputState) saved.lastEditInputState.repeatOverride = saved.repeatOverride;
    Object.assign(cm.state.vim, {
      lastEditInputState: saved.lastEditInputState,
      lastEditActionCommand: saved.lastEditActionCommand,
    });
    V.getVimGlobalState_().macroModeState.lastInsertModeChanges = saved.insertChanges;
  }
  function restoreSelection(cm, saved) {
    cm.operation(() => {
      if (cm.curOp) cm.curOp.isVimOp = true;
      cm.setSelections(saved.selections);
      Object.assign(cm.state.vim, { visualMode: saved.visualMode, visualLine: saved.visualLine });
      if (saved.sel) cm.state.vim.sel = saved.sel;
    });
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

  function customObject(cm, args, input) {
    const frame = frames.get(cm);
    const s = begin(cm, { input: cloneInput(input), request: { ...args } });
    s.saved = frame?.saved ?? s.saved;
    if (frame) frame.outcome = 'pending';
    restoreEdit(cm, s.saved);
    const ask = (label, accept) => {
      s.close = options.prompt(cm, { label, single: false, accept(value) {
        if (!valid(cm, s)) { cancel(cm, false); return; }
        if (!value || /[\r\n]/.test(value)) { notify('Vim Editing Extensions: boundaries must be non-empty single-line literals.'); cancel(cm); return; }
        accept(value);
      }, cancel: () => cancel(cm) });
    };
    ask('Left boundary', left => ask('Right boundary', right => {
      if (!valid(cm, s)) { cancel(cm, false); return; }
      sessions.delete(cm); s.close?.();
      restoreEdit(cm, s.saved);
      restoreSelection(cm, s.saved);
      resolvedPrompts.set(cm, { ...s.request, markers: [left, right] });
      cm.state.vim.inputState = cloneInput(s.input);
      V.handleKey(cm, OBJECT, 'vim-editing-extensions');
    }));
    return null;
  }
  function objectMotion(cm, head, args, vim, input) {
    const frame = frames.get(cm);
    if (frame) frame.outcome = 'failed';
    if (!supported(cm)) return null;
    const prepared = resolvedPrompts.get(cm);
    if (prepared) {
      resolvedPrompts.delete(cm);
      Object.assign(args, { ...prepared, repeat: args.repeat });
    }
    if (args.id === '?' && !args.markers) return customObject(cm, args, input ?? vim.lastEditInputState ?? vim.inputState);
    const text = cm.getValue();
    let selection;
    if (vim.visualMode) {
      const a = cm.indexFromPos(vim.sel.anchor), h = cm.indexFromPos(vim.sel.head);
      selection = { from: Math.min(a, h), to: Math.min(text.length, Math.max(a, h) + (text.codePointAt(Math.max(a, h)) > 0xFFFF ? 2 : 1)) };
    }
    const previous = visualObjects.get(cm);
    const token = JSON.stringify([args.id, args.variant, args.direction, args.markers]);
    const expand = !!(selection && previous?.token === token && previous.text === text && previous.from === selection.from && previous.to === selection.to);
    const result = resolveObject(text, { id: args.id, variant: args.variant, direction: args.direction, markers: args.markers,
      head: cm.indexFromPos(head), selection, expand, count: args.repeat || 1, tabSize: cm.getOption?.('tabSize') || 4 });
    if (!result) return null;
    if (frame) frame.outcome = 'matched';
    const { from, to, linewise } = result;
    if (selection) visualObjects.set(cm, { ...result, token, text }); else visualObjects.delete(cm);
    args.inclusive = false;
    args.linewise = linewise;
    if (vim.visualMode) vim.visualLine = linewise;
    const end = (vim.visualMode || linewise) && to > from ? previousCharacter(text, to) : to;
    return [cm.posFromIndex(from), cm.posFromIndex(end)];
  }
  V.defineMotion(NAME + 'object', objectMotion);
  for (const { keys, ...request } of mappings) for (const context of ['visual', 'operatorPending']) bind(keys, 'motion', 'object', request, { context });
  for (const context of ['visual', 'operatorPending']) bind(OBJECT, 'motion', 'object', {}, { context });

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

  function sourceRegister(name) {
    if (name && name !== '"' && !/^[a-z0-9]$/i.test(name)) {
      notify('Vim Editing Extensions: gr supports unnamed, letter and numbered Vim registers only; clipboard and special registers are not supported.');
      return null;
    }
    const register = V.getRegisterController().getRegister(name?.toLowerCase());
    if (register.blockwise) {
      notify('Vim Editing Extensions: gr does not support blockwise registers.');
      return null;
    }
    if (!register.toString()) {
      notify('Vim Editing Extensions: gr source register is empty.');
      return null;
    }
    return register;
  }
  V.defineOperator(REGISTER_REPLACE, (cm, args, ranges) => {
    if (registerContexts.get(cm)?.blocked || !supported(cm)) return;
    const register = sourceRegister(args.registerName);
    if (!register) return;
    const r = ranges[0];
    let from = Math.min(cm.indexFromPos(r.anchor), cm.indexFromPos(r.head));
    let to = Math.max(cm.indexFromPos(r.anchor), cm.indexFromPos(r.head));
    if (cm.state.vim.visualMode && args.lastSel) {
      // Some adapters already expand line selections, while evalInput also
      // advances the supplied head. Vim's inclusive visual endpoints are stable.
      const sel = args.lastSel;
      const a = cm.indexFromPos(sel.anchor), h = cm.indexFromPos(sel.head);
      const start = a <= h ? sel.anchor : sel.head;
      const end = a <= h ? sel.head : sel.anchor;
      const context = registerContexts.get(cm);
      if (context?.replay && args.visualSize) {
        const head = context.saved.selections[0].head;
        const count = args.repeat || 1;
        from = cm.indexFromPos(args.linewise ? { line: head.line, ch: 0 } : head);
        if (args.linewise) to = cm.indexFromPos({ line: head.line + args.visualSize.lines * count, ch: 0 });
        else if (args.visualSize.lines === 1) to = Math.min(from + args.visualSize.width * count, cm.indexFromPos({ line: head.line, ch: Infinity }));
        else to = cm.indexFromPos({ line: head.line + args.visualSize.lines * count - 1, ch: args.visualSize.endColumn });
      } else {
        from = cm.indexFromPos(args.linewise ? { line: start.line, ch: 0 } : start);
        const endIndex = cm.indexFromPos(end);
        const endColumn = end.ch + (cm.getValue().codePointAt(endIndex) > 0xFFFF ? 2 : 1);
        to = cm.indexFromPos(args.linewise ? { line: end.line + 1, ch: 0 } : { line: end.line, ch: endColumn });
        args.visualSize = { lines: end.line - start.line + 1, width: to - from, endColumn };
      }
    }
    const edit = registerEdit(cm.getValue(), from, to, register.toString(), register.linewise, args.linewise);
    if (!edit || !apply(cm, edit)) return;
    return cm.posFromIndex(edit.cursor);
  });
  // The native multikey-operator shortcut turns `grr` into expandToLine and
  // keeps counts, register prefixes, text objects and dot replay in the engine.
  bind('gr', 'operator', 'registerReplace');

  return {
    cancelAll() { tables.cancel(); prefixes.cancelAll(); for (const cm of [...sessions.keys()]) cancel(cm, false); },
    cancelTables() { tables.cancel(); },
    cancelPrefixes() { prefixes.cancelAll(); },
    hasPending: cm => sessions.has(cm) || prefixes.hasPending(cm) || tables.hasSelection(cm),
    finishInput(cm, key) {
      // Called after a physical key, not during the engine's internal clearInputState.
      const s = sessions.get(cm);
      if (s && !s.close && (['<Esc>', '<C-c>', '<C-[>'].includes(key) || !cm.state.vim.inputState.operator)) cancel(cm);
    },
    uninstall() {
      tables.cancel();
      prefixes.cancelAll();
      for (const cm of [...sessions.keys()]) cancel(cm);
      enabled = false;
      for (const [key, context] of bindings.reverse()) V.unmap(key, context);
      if (V.findKey === findKey) V.findKey = originalFindKey;
      // Definitions have no undefine API; they remain inert, namespaced, and unbound.
    },
  };
}
