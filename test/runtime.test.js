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
function keys(cm, sequence, origin = 'test') {
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
      const handled = V.handleKey(cm, key, origin);
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

test('new objects select explicit separators, arguments, calls, subwords, line text and links', () => {
  for (const [text, cursor, command, expected] of [
    ['one_two_three', 5, 'vi_', 'two'], ['one_two_three', 5, 'va_', 'two_'],
    ['foo_bar', 0, 'vi_', 'foo'], ['foo_bar', 6, 'va_', '_bar'],
    ['foo bar baz', 5, 'vi<Space>', 'bar'], ['foo bar baz', 5, 'va<Space>', 'bar '],
    ['one,two,three', 5, 'vi,', 'two'], ['f(first, nested("a,b", [1,2]), last)', 12, 'via', 'nested("a,b", [1,2])'],
    ['f(first, last)', 10, 'vaa', ', last'], ['obj.fn(one, two)', 8, 'vif', 'one, two'],
    ['obj.fn(one, two)', 8, 'vaf', 'obj.fn(one, two)'],
    ['snake_case', 7, 'viS', 'case'], ['XMLParser42', 5, 'viS', 'Parser'],
    ['  body  \nnext', 4, 'viL', 'body'], ['  body  \nnext', 4, 'vaL', '  body  '],
    ['![[Note|Alias]]', 5, 'viD', 'Note|Alias'], ['![[Note|Alias]]', 5, 'vaD', '[[Note|Alias]]'],
    ['["hello"]', 4, 'vio', '"hello"'], ['备注: 下周处理', 5, 'vik', '备注'],
    ['备注: 下周处理', 0, 'viv', '下周处理'], ['a = "hello",', 6, 'vav', '"hello",'],
  ]) {
    const cm = editor(text, cursor); keys(cm, command);
    assert.equal(cm.getSelection(), expected, command + ' in ' + text);
  }
});

test('new motions combine with native delete/change/yank, gr, counts, undo and repeat', () => {
  const cm = editor('one_two_three');
  keys(cm, 'di_'); assert.equal(cm.getValue(), '_two_three');
  keys(cm, 'u'); assert.equal(cm.getValue(), 'one_two_three');
  cm.setCursor(cm.posFromIndex(5)); keys(cm, 'ci_NEW<Esc>'); assert.equal(cm.getValue(), 'one_NEW_three');
  cm.setCursor(cm.posFromIndex(9)); keys(cm, '.'); assert.equal(cm.getValue(), 'one_NEW_NEW');
  const yank = editor('foo_bar');
  keys(yank, 'yi_'); assert.equal(V.getRegisterController().getRegister('"').toString(), 'foo');
  yank.setCursor(yank.posFromIndex(5)); keys(yank, 'gri_'); assert.equal(yank.getValue(), 'foo_foo');
  const counted = editor('one_two_three');
  setRegister('a', 'X'); keys(counted, '"agr2i_'); assert.equal(counted.getValue(), 'X_three');
  keys(counted, 'u'); keys(counted, 'v2i_'); assert.equal(counted.getSelection(), 'one_two');
});

test('object navigation crosses lines explicitly and repeated selection grows without wrapping', () => {
  const cm = editor('"one"\n"two"\n"three"', 1);
  keys(cm, 'vinq'); assert.equal(cm.getSelection(), 'two');
  keys(cm, '<Esc>'); cm.setCursor(cm.posFromIndex(1));
  keys(cm, 'v2inq'); assert.equal(cm.getSelection(), 'three');
  keys(cm, '<Esc>'); cm.setCursor(cm.posFromIndex(15));
  keys(cm, 'vilq'); assert.equal(cm.getSelection(), 'two');
  const flat = editor('one_two_three', 1);
  keys(flat, 'vi_i_'); assert.equal(flat.getSelection(), 'one_two');
  keys(flat, 'i_'); assert.equal(flat.getSelection(), 'one_two_three');
  keys(flat, 'i_'); assert.equal(flat.getSelection(), 'one_two_three');
  const distant = editor('before\n(hello)', 0);
  keys(distant, 'din)'); assert.equal(distant.getValue(), 'before\n()');
});

test('indentation motions produce exact linewise edits without consuming code fences', () => {
  const text = 'parent\n  one\n    child\n  two\nafter';
  const cm = editor(text, text.indexOf('child'));
  keys(cm, 'dii'); assert.equal(cm.getValue(), 'parent\n  one\n  two\nafter');
  keys(cm, 'u'); assert.equal(cm.getValue(), text);
  const gr = editor(text, text.indexOf('one'));
  setRegister('a', '  NEW'); keys(gr, '"agrii');
  assert.equal(gr.getValue(), 'parent\n  NEW\nafter');
  const fenced = editor('```yaml\n  one\n  two\n```\nafter', 12);
  keys(fenced, 'dai'); assert.equal(fenced.getValue(), '```yaml\n```\nafter');
  const visual = editor(text, text.indexOf('child'));
  keys(visual, 'vii'); assert.equal(visual.getSelection().replace(/\n$/, ''), '    child');
  assert.equal(visual.state.vim.visualLine, true);
});

test('missing new objects preserve native repeat and register state for all operators', () => {
  const cm = editor('one two');
  keys(cm, 'ciwNEW<Esc>'); cm.setCursor(cm.posFromIndex(4));
  const saved = cm.state.vim.lastEditInputState;
  setRegister('a', 'copied');
  for (const command of ['di_', 'ci_', '"ayi_', 'gria', 'diD', 'div']) {
    keys(cm, command);
    assert.equal(cm.getValue(), 'NEW two', command);
    assert.equal(cm.state.vim.lastEditInputState, saved, command);
    assert.equal(cm.state.vim.insertMode, false, command);
    assert.equal(V.getRegisterController().getRegister('a').toString(), 'copied');
  }
  keys(cm, '.'); assert.equal(cm.getValue(), 'NEW NEW');
});

test('custom boundaries preserve the operator, count, source register and repeat without prompting again', () => {
  const cm = editor('BEGINoneEND BEGINtwoEND', 6);
  keys(cm, 'di?BEGIN<CR>END<CR>'); assert.equal(cm.getValue(), 'BEGINEND BEGINtwoEND');
  cm.setCursor(cm.posFromIndex(16)); keys(cm, '.');
  assert.equal(cm.getValue(), 'BEGINEND BEGINEND'); assert.equal(prompts.has(cm), false);
  const visual = editor('**hello**', 4);
  keys(visual, 'vi?**<CR>**<CR>'); assert.equal(visual.getSelection(), 'hello');
  const gr = editor('BEGINoldEND', 6);
  setRegister('a', 'NEW'); keys(gr, '"agri?BEGIN<CR>END<CR>'); assert.equal(gr.getValue(), 'BEGINNEWEND');
  assert.equal(V.getRegisterController().getRegister('a').toString(), 'NEW');
  const change = editor('BEGINoldEND', 6);
  keys(change, 'ci?BEGIN<CR>END<CR>NEW<Esc>'); assert.equal(change.getValue(), 'BEGINNEWEND');
});

test('custom boundary cancellation and stale documents cannot edit or destroy previous repeat', () => {
  const cm = editor('one two'); keys(cm, 'ciwNEW<Esc>');
  cm.setCursor(cm.posFromIndex(4)); const previous = cm.state.vim.lastEditInputState;
  for (const command of ['di?<Esc>', 'di?BEGIN<CR><Esc>', 'di?<CR>']) {
    keys(cm, command); assert.equal(cm.getValue(), 'NEW two');
    assert.equal(cm.state.vim.lastEditInputState, previous);
  }
  keys(cm, 'di?BEGIN<CR>'); const request = prompts.get(cm);
  cm.setValue('changed externally'); prompts.delete(cm); request.accept('END');
  assert.equal(cm.getValue(), 'changed externally'); assert.equal(controller.hasPending(cm), false);
});

test('optional URL, whitespace and whole-document objects are reversible and keep normal I/A/L native', () => {
  controller.uninstall();
  controller = installVimExtensions(V, { ...installOptions, settings: { url: true, whitespace: true, buffer: true } });
  try {
    const url = editor('[link](https://example.com/a(b)).', 12);
    keys(url, 'yL'); assert.equal(V.getRegisterController().getRegister('"').toString(), 'https://example.com/a(b)');
    const spaces = editor('(  body  ) tail', 5);
    keys(spaces, 'vI('); assert.equal(spaces.getSelection(), 'body');
    keys(spaces, '<Esc>'); spaces.setCursor(spaces.posFromIndex(5));
    keys(spaces, 'vA('); assert.equal(spaces.getSelection(), '(  body  ) ');
    const all = editor('one\ntwo', 2); keys(all, 'ygG');
    assert.equal(V.getRegisterController().getRegister('"').toString(), 'one\ntwo\n');
    const normal = editor('word'); keys(normal, 'IPRE<Esc>AEND<Esc>'); assert.equal(normal.getValue(), 'PREwordEND');
    const block = editor('one\ntwo'); keys(block, '<C-v>jI');
    assert.equal(block.state.vim.insertMode, true, 'native block insertion must not wait for an object identifier');
    keys(block, '<Esc>'); assert.equal(block.getValue(), 'one\ntwo');
    controller.uninstall();
    controller = installVimExtensions(V, installOptions);
    const original = editor('body'); keys(original, 'vInew<Esc>'); assert.ok(original.getValue().includes('new'));
  } finally {
    controller.uninstall(); controller = installVimExtensions(V, installOptions);
  }
});

test('customized identifiers replace only owned mappings and disabled groups stay native', () => {
  controller.uninstall();
  controller = installVimExtensions(V, { ...installOptions, settings: { bindings: { L: 'Z' }, groups: { separators: false } } });
  const cm = editor('  one_two  ', 5);
  keys(cm, 'viZ'); assert.equal(cm.getSelection(), 'one_two');
  keys(cm, '<Esc>vi_'); assert.notEqual(cm.getSelection(), 'one');
  controller.uninstall(); controller = installVimExtensions(V, installOptions);
});

function timed(t, run, extra = {}) {
  controller.uninstall();
  t.mock.timers.enable({ apis: ['setTimeout', 'Date'], now: 1000 });
  controller = installVimExtensions(V, { ...installOptions, settings: { prefixTimeoutMs: 100 }, ...extra });
  try { run(); } finally {
    controller.uninstall();
    t.mock.timers.reset();
    controller = installVimExtensions(V, installOptions);
  }
}

test('100 ms prefix deadline restores native substitution, count and named register once', t => timed(t, () => {
  const cm = editor('hello');
  keys(cm, '"z2s');
  t.mock.timers.tick(99);
  assert.equal(cm.getValue(), 'hello');
  t.mock.timers.tick(1);
  assert.equal(cm.getValue(), 'llo');
  assert.equal(cm.state.vim.insertMode, true);
  assert.equal(V.getRegisterController().getRegister('z').toString(), 'he');
  t.mock.timers.tick(500);
  assert.equal(cm.getValue(), 'llo');
  keys(cm, 'X<Esc>');
  assert.equal(cm.getValue(), 'Xllo');
}));

test('timely sd/sa commit their prefix without timing out the remaining motion or target', t => timed(t, () => {
  const cm = editor('"hello"', 2);
  keys(cm, 's'); t.mock.timers.tick(99); keys(cm, 'd');
  t.mock.timers.tick(500); keys(cm, '"');
  assert.equal(cm.getValue(), 'hello');
  keys(cm, 's'); t.mock.timers.tick(99); keys(cm, 'a');
  t.mock.timers.tick(500); keys(cm, 'iw)');
  assert.equal(cm.getValue(), '(hello)');
}));

test('unmatched second key follows native s into insert mode without loss or duplication', t => timed(t, () => {
  const cm = editor('hello');
  keys(cm, 'sz<Esc>');
  assert.equal(cm.getValue(), 'zello');
  t.mock.timers.tick(500);
  assert.equal(cm.getValue(), 'zello');
}));

test('a delayed timer cannot accept a combination after its deadline', t => timed(t, () => {
  const cm = editor('hello');
  keys(cm, 's');
  // Move wall time without running the queued timer, as when the UI is busy.
  t.mock.timers.setTime(1100);
  keys(cm, 'd<Esc>');
  assert.equal(cm.getValue(), 'dello');
  t.mock.timers.tick(500);
  assert.equal(cm.getValue(), 'dello');
}));

test('fallback consults current custom mappings and keeps foreign s-prefixed mappings', t => timed(t, () => {
  V.map('s', 'x', 'normal');
  V.map('sZ', 'l', 'normal');
  try {
    const cm = editor('hello');
    keys(cm, 'sZ'); assert.equal(cm.getCursor().ch, 1); assert.equal(cm.getValue(), 'hello');
    keys(cm, 's'); t.mock.timers.tick(100); assert.equal(cm.getValue(), 'hllo');
    V.map('s', 'l', 'normal');
    keys(cm, 'sz'); assert.equal(cm.getValue(), 'hllo'); assert.equal(cm.getCursor().ch, 2);
  } finally { V.unmap('sZ', 'normal'); V.unmap('s', 'normal'); }
}));

test('Esc, stale document, moved cursor, inactive editor and uninstall cancel delayed actions', t => {
  let current = true;
  timed(t, () => {
    for (const change of [
      cm => keys(cm, '<Esc>'),
      cm => cm.setValue('changed'),
      cm => cm.setCursor({ line: 0, ch: 2 }),
      () => { current = false; },
      () => controller.cancelPrefixes(),
      () => controller.uninstall(),
    ]) {
      current = true;
      const cm = editor('hello'); keys(cm, 's'); change(cm);
      const text = cm.getValue();
      t.mock.timers.tick(100);
      assert.equal(cm.getValue(), text);
      assert.equal(cm.state.vim.insertMode, false);
      assert.equal(controller.hasPending(cm), false);
    }
  }, { isCurrent: () => current });
});

test('visual whitespace and navigation prefixes share timeout but native g/gr do not', t => timed(t, () => {
  const cm = editor('( one ) "two"', 2);
  keys(cm, 'vI'); t.mock.timers.tick(99); keys(cm, '(');
  assert.equal(cm.getSelection(), 'one');
  keys(cm, '<Esc>vin'); t.mock.timers.tick(99); keys(cm, '"');
  assert.equal(cm.getSelection(), 'two');
  keys(cm, '<Esc>');
  cm.setCursor({ line: 0, ch: 2 });
  setRegister('z', 'NEW'); keys(cm, '"zg'); t.mock.timers.tick(500); keys(cm, 'riw');
  assert.equal(cm.getValue(), '( NEW ) "two"');
}, { settings: { prefixTimeoutMs: 100, whitespace: true } }));

test('zero keeps indefinite waiting and invalid timeout settings are rejected', t => timed(t, () => {
  const cm = editor('"hello"', 2);
  keys(cm, 's'); t.mock.timers.tick(60001); keys(cm, 'd"');
  assert.equal(cm.getValue(), 'hello');
  for (const prefixTimeoutMs of [-1, 0.5, '100', null, NaN, 60001]) {
    assert.throws(() => installVimExtensions(V, { ...installOptions, settings: { prefixTimeoutMs } }), /Prefix timeout/);
  }
}, { settings: { prefixTimeoutMs: 0 } }));

test('unmatched physical key reaches a newly opened host listener exactly once', t => {
  let event;
  timed(t, () => {
    const cm = editor('hello');
    const input = document.createElement('input'); document.body.append(input); input.focus();
    let opened = 0, received = '';
    const listener = e => { received += e.key; e.preventDefault(); e.stopImmediatePropagation(); };
    V.defineAction('veeTestHost', () => { opened++; window.addEventListener('keydown', listener, true); });
    V.mapCommand('s', 'action', 'veeTestHost', {}, { context: 'normal' });
    try {
      event = new window.KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true });
      input.dispatchEvent(event); keys(cm, 's', 'user');
      event = new window.KeyboardEvent('keydown', { key: 'z', bubbles: true, cancelable: true });
      input.dispatchEvent(event); keys(cm, 'z', 'user');
      assert.equal(opened, 1); assert.equal(received, 'z');
      assert.equal(cm.getValue(), 'hello');
      t.mock.timers.tick(500); assert.equal(opened, 1);
    } finally { window.removeEventListener('keydown', listener, true); V.unmap('s', 'normal'); input.remove(); }
  }, { getEvent: () => event });
});

test('an internal Vim mapping never forwards its unrelated physical trigger to the host', t => {
  let event;
  timed(t, () => {
    const cm = editor('hello');
    const input = document.createElement('input'); document.body.append(input); input.focus();
    let received = '';
    const listener = e => { received += e.key; e.preventDefault(); };
    V.defineAction('veeTestMappedHost', () => window.addEventListener('keydown', listener, true));
    V.mapCommand('s', 'action', 'veeTestMappedHost', {}, { context: 'normal' });
    V.map('Q', 'sz', 'normal');
    try {
      event = new window.KeyboardEvent('keydown', { key: 'Q', bubbles: true, cancelable: true });
      input.dispatchEvent(event); keys(cm, 'Q', 'user');
      assert.equal(received, '');
      assert.equal(cm.getValue(), 'hello');
    } finally { window.removeEventListener('keydown', listener, true); V.unmap('Q', 'normal'); V.unmap('s', 'normal'); input.remove(); }
  }, { getEvent: () => event });
});

const TABLE = '| Name | Value |\n| --- | --- |\n| alpha | one |\n| beta | two |\n';
test('whole-table yank preserves Markdown and native named, append and black-hole register behavior', () => {
  const cm = editor('Before\n\n' + TABLE + '\nAfter', 15);
  keys(cm, 'yiT');
  assert.equal(V.getRegisterController().getRegister('"').toString(), TABLE);
  assert.equal(V.getRegisterController().getRegister('0').toString(), TABLE);
  assert.equal(V.getRegisterController().getRegister('"').linewise, true);
  keys(cm, '"zyiT'); assert.equal(V.getRegisterController().getRegister('z').toString(), TABLE);
  keys(cm, '"ZyiT'); assert.equal(V.getRegisterController().getRegister('z').toString(), TABLE + TABLE);
  const saved = registerState(); keys(cm, '"_yiT'); assert.deepEqual(registerState(), saved);
  assert.equal(cm.getValue(), 'Before\n\n' + TABLE + '\nAfter');
  keys(cm, 'yaT'); assert.equal(V.getRegisterController().getRegister('"').toString(), TABLE + '\n');
});

test('visual table selection yanks from the outer document after a cell editor loses its visual selection', async () => {
  controller.uninstall();
  const root = editor('Before\n\n' + TABLE + '\nAfter', 40), header = editor('Name'), body = editor('alpha');
  const painted = [];
  controller = installVimExtensions(V, { ...installOptions,
    isCurrent: cm => cm === root,
    tableContext: cm => [root, header, body].includes(cm) ? { root, at: 40 } : null,
    paintTable: (cm, range) => painted.push({ cm, range }),
  });
  try {
    keys(header, 'viT');
    assert.equal(painted.at(-1).cm, root);
    assert.equal(root.getValue().slice(painted.at(-1).range.from, painted.at(-1).range.to), TABLE);
    // Real live preview reconciles/refocuses nested editors between physical
    // keys. Neither the native selection nor the original cell may survive.
    root.setCursor({ line: 4, ch: 4 }); header.state.vim.visualMode = false;
    await new Promise(resolve => setTimeout(resolve, 30));
    keys(body, 'y');
    assert.equal(V.getRegisterController().getRegister('"').toString(), TABLE);
    assert.equal(painted.at(-1).range, null);
    keys(body, 'yiT'); assert.equal(V.getRegisterController().getRegister('"').toString(), TABLE);
    keys(body, 'viT"zy'); assert.equal(V.getRegisterController().getRegister('z').toString(), TABLE);
    assert.equal(body.getValue(), 'alpha'); assert.equal(header.getValue(), 'Name');
  } finally { controller.uninstall(); controller = installVimExtensions(V, installOptions); }
});

test('table selection cancels on Esc, document changes, other keys and uninstall without copying stale text', () => {
  const cm = editor(TABLE, 5);
  setRegister('z', 'KEEP');
  for (const change of [() => keys(cm, '<Esc>'), () => controller.cancelTables(), () => keys(cm, 'h')]) {
    keys(cm, 'viT'); assert.equal(controller.hasPending(cm), true);
    change(); assert.equal(controller.hasPending(cm), false);
  }
  keys(cm, 'viT'); cm.setValue('changed'); keys(cm, 'y<Esc>');
  assert.equal(V.getRegisterController().getRegister('z').toString(), 'KEEP');
  assert.equal(cm.getValue(), 'changed');
  cm.setValue(TABLE); keys(cm, 'viT'); controller.uninstall();
  assert.equal(controller.hasPending(cm), false);
  controller = installVimExtensions(V, installOptions);
});

test('table commands reject unsupported editing/counts and retain native lowercase tag and paragraph objects', () => {
  for (const sequence of ['diT', 'ciT', '2yiT', 'viTd']) {
    const cm = editor(TABLE, 5), before = registerState(); keys(cm, sequence);
    assert.equal(cm.getValue(), TABLE); assert.deepEqual(registerState(), before);
  }
  controller.uninstall();
  const native = editor('<b>hello</b>', 4); keys(native, 'vit'); const tag = native.getSelection();
  keys(native, '<Esc>vip'); const paragraph = native.getSelection();
  controller = installVimExtensions(V, installOptions);
  const cm = editor('<b>hello</b>', 4); keys(cm, 'vit'); assert.equal(cm.getSelection(), tag);
  keys(cm, '<Esc>vip'); assert.equal(cm.getSelection(), paragraph);
  controller.uninstall();
  controller = installVimExtensions(V, { ...installOptions, settings: { bindings: { T: 'Z' } } });
  const custom = editor(TABLE, 5); keys(custom, 'yiZ'); assert.equal(V.getRegisterController().getRegister('"').toString(), TABLE);
  controller.uninstall(); controller = installVimExtensions(V, installOptions);
});

after(() => { controller.uninstall(); views.forEach(v => v.destroy()); dom.window.close(); });
