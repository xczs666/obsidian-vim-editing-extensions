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
const installOptions = {
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

after(() => { controller.uninstall(); views.forEach(v => v.destroy()); dom.window.close(); });
