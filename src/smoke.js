// Run only through the explicit compatibility-check command, in a disposable note.
export async function runSmoke(plugin) {
  const app = plugin.app;
  const original = app.workspace.activeLeaf;
  const path = `Vim Editing Extensions check ${Date.now()}.md`;
  const file = await app.vault.create(path, 'Vim Editing Extensions compatibility check\n');
  const leaf = app.workspace.getLeaf('tab');
  const results = [];
  let view;
  const pause = () => new Promise(resolve => setTimeout(resolve, 40));
  try {
    await leaf.openFile(file, { active: true, state: { mode: 'source' } });
    plugin.install();
    await pause();
    view = leaf.view;
    const cm = plugin.getCM(view);
    if (!cm) throw new Error('Markdown Vim adapter is unavailable');
    const win = cm.getWrapperElement().ownerDocument.defaultView;
    const V = win.CodeMirrorAdapter.Vim;
    if (!plugin.controllers.has(V)) throw new Error('Vim extensions were not registered');
    const editor = view.editor;
    async function reset(text, cursor = 0) {
      V.handleKey(cm, '<Esc>');
      editor.setValue(text);
      editor.setCursor(editor.offsetToPos(cursor));
      await pause();
    }
    async function keys(sequence) {
      for (const key of sequence.match(/<[^>]+>|[\s\S]/g) ?? []) {
        const input = win.document.querySelector('[data-vim-editing-prompt] input');
        if (input) {
          const name = key === '<CR>' ? 'Enter' : key === '<Esc>' ? 'Escape' : key;
          if (input.getAttribute('aria-label') === 'Tag name and attributes' && key.length === 1) {
            input.value += key;
            input.dispatchEvent(new win.Event('input', { bubbles: true }));
          } else input.dispatchEvent(new win.KeyboardEvent('keydown', { key: name, keyCode: name === 'Enter' ? 13 : name === 'Escape' ? 27 : key.charCodeAt(0), bubbles: true, cancelable: true }));
        } else V.handleKey(cm, key, 'compatibility-check');
      }
      await pause();
    }
    const fixtures = [
      ['viq', '"hello"', 2, 'hello', true], ['vaq', "'hello'", 2, "'hello'", true],
      ['diq', '"hello"', 2, '""'], ['daq', '"hello"', 2, ''],
      ['vib', '[hello]', 2, 'hello', true], ['vib', '"hello"', 2, 'hello', true],
      ['vib', '<span>hello</span>', 8, 'hello', true], ['vab', '[hello]', 2, '[hello]', true],
      ['v2ib', '([hello])', 3, '[hello]', true],
      ['saiw)', 'hello', 0, '(hello)'], ['sd"', '"hello"', 2, 'hello'],
      ['sr"\'', '"hello"', 2, "'hello'"], ['sdt', '<span class="x">hello</span>', 18, 'hello'],
      ['2sd)', '(outer(inner)tail)', 8, 'outer(inner)tail'],
      ['2saiw)', 'hello', 0, '((hello))'],
      ['sdb', '[hello]', 2, 'hello'], ['srb"', '(hello)', 2, '"hello"'],
      ['srt"', '<b>hello</b>', 4, '"hello"'],
      ['viwsa)', 'hello', 2, '(hello)'], ['vabsd', '(hello)', 2, 'hello'],
      ['vabsr"', '(hello)', 2, '"hello"'],
      ['saiwtspan class="x"<CR>', 'hello', 0, '<span class="x">hello</span>'],
      ['saiw)<Esc>', 'hello', 0, '(hello)'], ['saiw<Esc>', 'hello', 0, 'hello'],
    ];
    for (const live of [false, true]) {
      await view.setState({ ...view.getState(), mode: 'source', source: !live }, { history: false });
      for (const [command, text, cursor, expected, selection] of fixtures) {
        try {
          await reset(text, cursor); await keys(command);
          const actual = selection ? editor.getSelection() : editor.getValue();
          results.push({ mode: live ? 'live-preview' : 'source', command, expected, actual, passed: actual === expected });
        } catch (error) { results.push({ mode: live ? 'live-preview' : 'source', command, passed: false, error: String(error) }); }
      }
      await reset('hello world'); await keys('saiw)');
      editor.setCursor(editor.offsetToPos(9)); await keys('.');
      results.push({ mode: live ? 'live-preview' : 'source', command: 'add + repeat', passed: editor.getValue() === '(hello) (world)', actual: editor.getValue() });
      await keys('u');
      results.push({ mode: live ? 'live-preview' : 'source', command: 'atomic undo', passed: editor.getValue() === '(hello) world', actual: editor.getValue() });
      await keys('<C-r>');
      results.push({ mode: live ? 'live-preview' : 'source', command: 'redo', passed: editor.getValue() === '(hello) (world)', actual: editor.getValue() });
    }
    return { runtime: app.getVersion?.() ?? win.require('obsidian').apiVersion, testedAt: new Date().toISOString(), passed: results.filter(r => r.passed).length, results };
  } finally {
    // Flush the pending Markdown save before trashing the disposable file.
    // Otherwise its delayed save may recreate the file after deletion.
    await view?.save?.();
    leaf.detach();
    if (original) app.workspace.setActiveLeaf(original, { focus: true });
    await app.vault.trash(file, false);
  }
}
