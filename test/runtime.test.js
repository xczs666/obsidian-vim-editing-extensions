import assert from 'node:assert/strict';
import { test, after } from 'node:test';
import { installDOM, actualVim } from './environment.js';
import { installVimExtensions } from '../src/vim.js';

const dom = installDOM();
const { EditorState } = await import('@codemirror/state');
const { EditorView } = await import('@codemirror/view');
const { history, isolateHistory } = await import('@codemirror/commands');
const { CodeMirror, Vim: referenceVim, vim: vimExtension, getCM } = await import('@replit/codemirror-vim');
// Obsidian adds these adapter methods to the upstream CM6 bridge. They only
// translate positions/selections; key dispatch and repeat use its real engine.
CodeMirror.prototype.getMainSelection = function () {
  const r = this.cm6.state.selection.main;
  return { anchor: this.posFromIndex(r.anchor), head: this.posFromIndex(r.head) };
};
CodeMirror.prototype.moveByChar = function (head, forward, repeat) {
  let offset = this.indexFromPos(head);
  const text = this.getValue();
  for (let i = 0; i < repeat; i++) offset = Math.max(0, Math.min(text.length, offset + (forward ? 1 : -1)));
  return this.posFromIndex(offset);
};
const V = actualVim(CodeMirror, referenceVim);
const originalDispatcher = V.findKey;
const views = [];
const prompts = new Map();
const notices = [];
const installOptions = {
  notify(message) { notices.push(message); },
  prompt(cm, request) { prompts.set(cm, request); return () => { prompts.delete(cm); }; },
  applyEdit(cm, edit) {
    cm.operation(() => {
      cm.curOp.isVimOp = true;
      cm.cm6.dispatch({ changes: { from: edit.from, to: edit.to, insert: edit.insert }, selection: { anchor: edit.cursor }, annotations: isolateHistory.of('full') });
    });
  },
};
let controller = installVimExtensions(V, installOptions);
function editor(text, cursor = 0) {
  const view = new EditorView({ state: EditorState.create({ doc: text, extensions: [EditorState.allowMultipleSelections.of(true), history(), vimExtension()] }), parent: document.body });
  views.push(view);
  const cm = getCM(view);
  // vimExtension already initialized the reference engine. Initializing it
  // twice duplicates cursor handlers and corrupts insert-mode repeat recording.
  if (V !== referenceVim) V.enterVimMode(cm);
  cm.setCursor(cm.posFromIndex(cursor));
  return cm;
}
function keys(cm, sequence) {
  const tokens = sequence.match(/<[^>]+>|[\s\S]/g) ?? [];
  let tag = '';
  for (const key of tokens) {
    const request = prompts.get(cm);
    if (request) {
      if (key === '<Esc>') { prompts.delete(cm); request.cancel(); }
      else if (request.single) { prompts.delete(cm); request.accept(key); }
      else if (key === '<CR>') { prompts.delete(cm); request.accept(tag); tag = ''; }
      else tag += key;
    } else {
      const handled = V.handleKey(cm, key, 'test');
      if (!handled && cm.state.vim.insertMode && key.length === 1) {
        cm.operation(() => cm.replaceSelection(key, 'end', '+input'));
      }
      controller.finishInput(cm, key);
    }
  }
}

test('Vim engine: iq/aq and ib/ab work with visual, delete and yank', () => {
  for (const [text, command, expected] of [
    ['"hello"', 'viq', 'hello'], ['"hello"', 'vaq', '"hello"'],
    ['[hello]', 'vib', 'hello'], ['"hello"', 'vib', 'hello'],
    ['<span>hello</span>', 'vib', 'hello'],
  ]) {
    const cm = editor(text, Math.floor(text.length / 2));
    keys(cm, command);
    assert.equal(cm.getSelection(), expected, command + ' in ' + text);
  }
  const cm = editor('"hello"', 2);
  keys(cm, 'diq'); assert.equal(cm.getValue(), '""');
});

test('delete, replacement, native repeat and atomic undo', () => {
  const cm = editor('"hello" "world"', 2);
  keys(cm, 'sr"\''); assert.equal(cm.getValue(), "'hello' \"world\"");
  cm.setCursor(cm.posFromIndex(10));
  keys(cm, '.'); assert.equal(cm.getValue(), "'hello' 'world'");
  keys(cm, 'u'); assert.equal(cm.getValue(), "'hello' \"world\"");
  keys(cm, '<C-r>'); assert.equal(cm.getValue(), "'hello' 'world'");
});

test('add operator combines native motions with a trailing delimiter and repeats', () => {
  const cm = editor('hello world');
  keys(cm, 'saiw)'); assert.equal(cm.getValue(), '(hello) world');
  cm.setCursor(cm.posFromIndex(9));
  keys(cm, '.'); assert.equal(cm.getValue(), '(hello) (world)');
});

test('counted, nested, visual, empty and unicode edit fixtures', () => {
  const fixtures = [
    ['hello', 0, '2saiw)', '((hello))'],
    ['one two three', 0, 'sa2w)', '(one two )three'],
    ['(outer(inner)tail)', 8, '2sd)', 'outer(inner)tail'],
    ['(outer(inner)tail)', 8, '2sr)"', '"outer(inner)tail"'],
    ['[hello]', 2, 'sdb', 'hello'],
    ['(hello)', 2, 'srb"', '"hello"'],
    ['<b>hello</b>', 4, 'srt"', '"hello"'],
    ['hello', 2, 'viwsa)', '(hello)'],
    ['(hello)', 2, 'vabsd', 'hello'],
    ['(hello)', 2, 'vabsr"', '"hello"'],
    ['""', 0, 'diq', '""'],
    ['"hello"', 2, 'ciqnew<Esc>', '"new"'],
    ['""', 0, 'ciqnew<Esc>', '"new"'],
    ['"中文😀"', 2, 'diq', '""'],
    ['hello', 0, 'saiwtspan class="x"<CR>', '<span class="x">hello</span>'],
  ];
  for (const [text, cursor, command, expected] of fixtures) {
    const cm = editor(text, cursor); keys(cm, command);
    assert.equal(cm.getValue(), expected, command + ' in ' + text);
  }
});

test('visual text objects grow outward and support operator registers', () => {
  const cm = editor('(["hello"])', 5);
  keys(cm, 'vib'); assert.equal(cm.getSelection(), 'hello');
  keys(cm, 'ib'); assert.equal(cm.getSelection(), '"hello"');
  keys(cm, '<Esc>');
  keys(cm, '"zyiq'); assert.equal(V.getRegisterController().getRegister('z').toString(), 'hello');
});

test('cancelled and missing targets preserve text and native repeat', () => {
  const cm = editor('"hello" world', 2);
  keys(cm, 'sd"');
  cm.setCursor(cm.posFromIndex(6));
  const last = cm.state.vim.lastEditActionCommand;
  keys(cm, 'sr)<Esc>'); assert.equal(cm.getValue(), 'hello world');
  assert.equal(cm.state.vim.lastEditActionCommand, last);
  keys(cm, 'saiw<Esc>'); assert.equal(cm.getValue(), 'hello world');
  assert.equal(cm.state.vim.lastEditActionCommand, last);
  keys(cm, 'saiwtbr<CR>'); assert.equal(cm.getValue(), 'hello world');
  assert.equal(cm.state.vim.lastEditActionCommand, last);
});

test('native editing replaces extension repeat and ordinary motion stays usable', () => {
  const cm = editor('hello world');
  keys(cm, 'saiw)');
  cm.setCursor(cm.posFromIndex(8)); keys(cm, 'x');
  keys(cm, '.'); assert.equal(cm.getValue(), '(hello) rld');
  keys(cm, 'h'); assert.equal(cm.getCursor().ch, 7);
});

test('linewise add, delete, replacement and atomic history', () => {
  const cm = editor('hello\nworld\n');
  keys(cm, 'Vjsa)'); assert.equal(cm.getValue(), '(\nhello\nworld\n)\n');
  keys(cm, 'u'); assert.equal(cm.getValue(), 'hello\nworld\n');
});

test('document changes during prompts cancel without restoring stale selections', () => {
  const cm = editor('hello'); keys(cm, 'saiwt');
  const request = prompts.get(cm);
  cm.setValue('changed externally');
  prompts.delete(cm); request.accept('span');
  assert.equal(cm.getValue(), 'changed externally');
  assert.equal(controller.hasPending(cm), false);
});

test('cancel does not lose insert-mode replay; counts grow object selection', () => {
  const cm = editor('one two');
  keys(cm, 'ciwNEW<Esc>');
  cm.setCursor(cm.posFromIndex(4)); keys(cm, 'saiw<Esc>.');
  assert.equal(cm.getValue(), 'NEW NEW');
  const nested = editor('([hello])', 4);
  keys(nested, 'v2ib'); assert.equal(nested.getSelection(), '[hello]');
});

test('block mode and multiple cursors are rejected without changing text', () => {
  const cm = editor('one two');
  cm.setSelections([{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } }, { anchor: { line: 0, ch: 4 }, head: { line: 0, ch: 4 } }]);
  keys(cm, 'sa'); assert.equal(cm.getValue(), 'one two');
  const block = editor('one\ntwo');
  keys(block, '<C-v>jsa'); assert.equal(block.getValue(), 'one\ntwo');
});

test('disable/re-enable removes only owned bindings and restores native ib', () => {
  controller.uninstall();
  assert.equal(V.findKey, originalDispatcher);
  const cm = editor('[hello]', 3);
  keys(cm, 'vib'); assert.notEqual(cm.getSelection(), 'hello');
  keys(cm, '<Esc>');
  controller = installVimExtensions(V, installOptions);
  keys(cm, 'vib'); assert.equal(cm.getSelection(), 'hello');
  controller.uninstall();
  controller = installVimExtensions(V, installOptions);
  keys(cm, '<Esc>sd]'); assert.equal(cm.getValue(), 'hello');
});

test('standalone install preserves and restores an existing single-s mapping', () => {
  controller.uninstall();
  V.map('s', 'x', 'normal');
  controller = installVimExtensions(V, installOptions);
  const cm = editor('"hello"', 2);
  keys(cm, 'sd"'); assert.equal(cm.getValue(), 'hello');
  controller.uninstall();
  keys(cm, 's'); assert.equal(cm.getValue(), 'ello');
  V.unmap('s', 'normal');
  controller = installVimExtensions(V, installOptions);
});

function setRegister(name, text, linewise = false, blockwise = false) {
  V.getRegisterController().getRegister(name).setText(text, linewise, blockwise);
}
function registerState() {
  const rc = V.getRegisterController();
  return Object.fromEntries(['"', ...Object.keys(rc.registers)].map(name => {
    const reg = rc.getRegister(name);
    return [name, { text: reg.toString(), linewise: reg.linewise, blockwise: reg.blockwise }];
  }));
}

test('gr uses native motions, counts, text objects and Unicode boundaries', () => {
  for (const [text, cursor, command, expected] of [
    ['old tail', 0, 'griw', 'NEW tail'],
    ['old tail', 0, 'grw', 'NEWtail'],
    ['old tail', 0, 'gr$', 'NEW'],
    ['one two three', 0, 'gr2w', 'NEWthree'],
    ['one two three', 0, '2grw', 'NEWthree'],
    ['"old"', 2, 'griq', '"NEW"'],
    ['[old]', 2, 'grib', '[NEW]'],
    ['""', 0, 'griq', '"NEW"'],
    ['"中文😀"', 2, 'griq', '"NEW"'],
    ['one two', 4, 'grb', 'NEWtwo'],
  ]) {
    const cm = editor(text, cursor);
    setRegister('"', 'NEW');
    keys(cm, command);
    assert.equal(cm.getValue(), expected, command + ' in ' + text);
    assert.equal(V.getRegisterController().getRegister('"').toString(), 'NEW');
  }
});

test('gr reads named and numbered registers and never overwrites copied text', () => {
  const cm = editor('source old tail');
  keys(cm, '"ayiw');
  setRegister('0', 'ZERO');
  cm.setCursor(cm.posFromIndex(7));
  const saved = registerState();
  keys(cm, '"agriw'); assert.equal(cm.getValue(), 'source source tail');
  cm.setCursor(cm.posFromIndex(14));
  keys(cm, '"Agriw'); assert.equal(cm.getValue(), 'source source source');
  assert.deepEqual(registerState(), saved);
  cm.setCursor(cm.posFromIndex(7));
  keys(cm, '"0griw'); assert.equal(cm.getValue(), 'source ZERO source');
  assert.deepEqual(registerState(), saved);
});

test('grr and visual gr honor line ranges, source types and EOF', () => {
  for (const [text, cursor, command, value, linewise, expected] of [
    ['old\nnext', 1, 'grr', '  NEW', false, '  NEW\nnext'],
    ['one\ntwo\nthree', 1, '2grr', 'NEW\n', true, 'NEW\nthree'],
    ['one\ntwo\nthree', 1, 'gr2r', 'NEW\n', true, 'NEW\nthree'],
    ['old', 1, 'grr', 'NEW\n', true, 'NEW'],
    ['old\n', 1, 'grr', 'NEW\n', true, 'NEW\n'],
    ['one\ntwo', 5, 'grr', 'NEW\n', true, 'one\nNEW'],
    ['old tail', 1, 'viwgr', 'NEW\n', true, 'NEW tail'],
    ['old tail', 2, 'vhhgr', 'NEW', false, 'NEW tail'],
    // Explicit line motions avoid jsdom's unavailable vertical layout metrics.
    ['one\ntwo\nthree', 1, 'V2Ggr', 'NEW', false, 'NEW\nthree'],
    ['one\ntwo', 5, 'Vgggr', 'NEW', false, 'NEW'],
  ]) {
    const cm = editor(text, cursor);
    setRegister('"', value, linewise);
    keys(cm, command);
    assert.equal(cm.getValue(), expected, command + ' in ' + JSON.stringify(text));
  }
});

test('gr supports current-register dot replay, atomic undo/redo and native edit takeover', () => {
  const cm = editor('one two three');
  setRegister('a', 'NEW');
  keys(cm, '"agriw'); assert.equal(cm.getValue(), 'NEW two three');
  keys(cm, 'w'); setRegister('a', 'NEXT');
  keys(cm, '.'); assert.equal(cm.getValue(), 'NEW NEXT three');
  keys(cm, 'u'); assert.equal(cm.getValue(), 'NEW two three');
  keys(cm, '<C-r>'); assert.equal(cm.getValue(), 'NEW NEXT three');
  keys(cm, 'w'); keys(cm, 'x.'); assert.equal(cm.getValue(), 'NEW NEXT ree');
});

test('gr dot replay preserves visual sizes and replaces counted ranges once', () => {
  const cm = editor('one two three four');
  setRegister('"', 'X');
  keys(cm, 'grw'); assert.equal(cm.getValue(), 'Xtwo three four');
  keys(cm, 'w2.'); assert.equal(cm.getValue(), 'Xtwo X');
  const visual = editor('abc def ghi');
  setRegister('"', 'X');
  keys(visual, 'vllgr'); assert.equal(visual.getValue(), 'X def ghi');
  keys(visual, 'w.'); assert.equal(visual.getValue(), 'X X ghi');
  const countedVisual = editor('abc defghi tail');
  setRegister('"', 'X');
  keys(countedVisual, 'vllgrw2.'); assert.equal(countedVisual.getValue(), 'X X tail');
  const lines = editor('one\ntwo\nthree\nfour\nfive\nsix');
  setRegister('"', 'X');
  keys(lines, 'V2Ggr'); assert.equal(lines.getValue(), 'X\nthree\nfour\nfive\nsix');
  keys(lines, '2G.'); assert.equal(lines.getValue(), 'X\nX\nfive\nsix');
  const multiline = editor('ab\ncd\nef\ngh');
  setRegister('"', 'X');
  keys(multiline, 'v2Ggr'); assert.equal(multiline.getValue(), 'Xd\nef\ngh');
  keys(multiline, '2G.'); assert.equal(multiline.getValue(), 'Xd\nXh');
  const unicode = editor('ab a😀tail');
  setRegister('"', 'X');
  keys(unicode, 'vlgrw.'); assert.equal(unicode.getValue(), 'X Xtail');
});

test('failed and cancelled gr preserve the previous edit, source register and selection', () => {
  const cm = editor('one two');
  keys(cm, 'ciwNEW<Esc>');
  cm.setCursor(cm.posFromIndex(4));
  const last = cm.state.vim.lastEditInputState;
  setRegister('"', 'VALUE');
  keys(cm, 'griq'); assert.equal(cm.getValue(), 'NEW two');
  assert.equal(cm.state.vim.lastEditInputState, last);
  keys(cm, 'gr<Esc>'); assert.equal(cm.state.vim.lastEditInputState, last);
  setRegister('z', ''); keys(cm, '"zgriw');
  assert.equal(cm.state.vim.lastEditInputState, last);
  keys(cm, '"+griw'); assert.equal(cm.getValue(), 'NEW two');
  assert.ok(notices.some(message => message.includes('clipboard')));
  keys(cm, '.'); assert.equal(cm.getValue(), 'NEW NEW');
  const visual = editor('one two');
  setRegister('z', ''); keys(visual, 'viw"zgr');
  assert.equal(visual.getValue(), 'one two'); assert.equal(visual.getSelection(), 'one');
  assert.equal(visual.state.vim.visualMode, true);
});

test('gr rejects block registers, block selections and multiple cursors', () => {
  const block = editor('one\ntwo');
  setRegister('a', 'X', false, true);
  keys(block, '"agriw'); assert.equal(block.getValue(), 'one\ntwo');
  setRegister('"', 'NEW');
  keys(block, '<C-v>jgr'); assert.equal(block.getValue(), 'one\ntwo');
  keys(block, '<Esc>');
  block.setSelections([{ anchor: { line: 0, ch: 0 }, head: { line: 0, ch: 0 } }, { anchor: { line: 1, ch: 0 }, head: { line: 1, ch: 0 } }]);
  keys(block, 'griw'); assert.equal(block.getValue(), 'one\ntwo');
});

test('gr disable/re-enable restores pre-existing mappings', () => {
  controller.uninstall();
  V.map('gr', 'x', 'normal');
  controller = installVimExtensions(V, installOptions);
  const cm = editor('old tail');
  setRegister('"', 'NEW'); keys(cm, 'griw');
  assert.equal(cm.getValue(), 'NEW tail');
  controller.uninstall(); keys(cm, 'gr');
  assert.equal(cm.getValue(), 'EW tail');
  V.unmap('gr', 'normal');
  controller = installVimExtensions(V, installOptions);
  setRegister('"', 'OK'); keys(cm, 'griw'); assert.equal(cm.getValue(), 'OK tail');
});

after(() => { controller.uninstall(); views.forEach(v => v.destroy()); dom.window.close(); });
