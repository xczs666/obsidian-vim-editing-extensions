// Run only through the explicit compatibility-check command, in a disposable note.
export async function runSmoke(plugin) {
  const app = plugin.app;
  const original = app.workspace.activeLeaf;
  const path = `Vim Editing Extensions check ${Date.now()}.md`;
  const file = await app.vault.create(path, 'Vim Editing Extensions compatibility check\n');
  const leaf = app.workspace.getLeaf('tab');
  const results = [];
  const skippedObjectGroups = [];
  let view;
  let restoreRegisters;
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
    const registers = V.getRegisterController();
    const originalRegisters = { ...registers.registers };
    const originals = new Map([...Object.values(originalRegisters), registers.unnamedRegister].map(register => [register, {
      ...register,
      keyBuffer: [...register.keyBuffer],
      insertModeChanges: [...register.insertModeChanges],
      searchQueries: [...register.searchQueries],
    }]));
    restoreRegisters = () => {
      for (const name of Object.keys(registers.registers)) delete registers.registers[name];
      Object.assign(registers.registers, originalRegisters);
      for (const [register, saved] of originals) Object.assign(register, saved);
    };
    const editor = view.editor;
    async function reset(text, cursor = 0) {
      V.handleKey(cm, '<Esc>');
      editor.setValue(text);
      editor.setCursor(editor.offsetToPos(cursor));
      registers.getRegister('z').setText('');
      await pause();
    }
    async function keys(sequence) {
      for (const key of sequence.match(/<[^>]+>|[\s\S]/g) ?? []) {
        const input = win.document.querySelector('[data-vim-editing-prompt] input');
        if (input) {
          const name = key === '<CR>' ? 'Enter' : key === '<Esc>' ? 'Escape' : key;
          if (input.getAttribute('aria-label') !== 'Surround with character (t: tag)' && key.length === 1) {
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
      ['yiwwgriw', 'NEW old', 0, 'NEW NEW'],
      ['"ayiww"agriw', 'NEW old', 0, 'NEW NEW'],
      ['"ayiww"Agriw', 'NEW old', 0, 'NEW NEW'],
      ['yiww"0griw', 'NEW old', 0, 'NEW NEW'],
      ['yiwwgriq', 'NEW "old"', 0, 'NEW "NEW"'],
      ['yiwwgrib', 'NEW [old]', 0, 'NEW [NEW]'],
      ['yiwwgr2w', 'NEW one two tail', 0, 'NEW NEWtail'],
      ['yiw2Ggrr', 'NEW\nold\nnext', 0, 'NEW\nNEW\nnext'],
      ['yy2Ggrr', 'NEW\nold\nnext', 0, 'NEW\nNEW\nnext'],
      ['yiw2G2grr', 'NEW\none\ntwo\nnext', 0, 'NEW\nNEW\nnext'],
      ['yy2Ggriw', 'NEW\nold', 0, 'NEW\nNEW'],
      ['yiwwviwgr', 'NEW old', 0, 'NEW NEW'],
      ['yiw2GVjgr', 'NEW\none\ntwo\nnext', 0, 'NEW\nNEW\nnext'],
      ['yiwwgriq', 'NEW "中文😀"', 0, 'NEW "NEW"'],
      ['"zgriw', 'old', 0, 'old'],
      ['"+griw', 'old', 0, 'old'],
      ['yiwwgr<Esc>', 'NEW old', 0, 'NEW old'],
    ];
    // New fixtures are skipped for explicitly disabled groups or custom IDs;
    // remapped identifiers are covered by runtime tests rather than guessed here.
    const addObjects = (group, rows) => {
      if (plugin.settings?.groups[group] !== false && !Object.keys(plugin.settings?.bindings ?? {}).length) fixtures.push(...rows);
      else skippedObjectGroups.push(group);
    };
    addObjects('separators', [
      ['vi_', 'foo_bar', 0, 'foo', true], ['va_', 'foo_bar', 6, '_bar', true],
      ['vi_', 'one_two_three', 5, 'two', true], ['va_', 'one_two_three', 5, 'two_', true],
      ['vi<Space>', 'one two three', 5, 'two', true], ['va<Space>', 'one two three', 5, 'two ', true],
      ['vi,', 'one,two,three', 5, 'two', true], ['v2i_', 'one_two_three', 1, 'one_two', true],
      ['vi_i_i_', 'one_two_three', 1, 'one_two_three', true],
      ['yiwwgri_', 'NEW\nold_value', 0, 'NEW\nNEW_value'],
    ]);
    addObjects('line', [['viL', '  body  \nnext', 4, 'body', true], ['vaL', '  body  \nnext', 4, '  body  ', true]]);
    addObjects('subword', [['viS', 'snake_case', 7, 'case', true], ['viS', 'XMLParser42', 5, 'Parser', true], ['yiwwgriS', 'NEW snake_case', 0, 'NEW NEW_case']]);
    addObjects('brackets', [['viD', '![[Note|Alias]]', 5, 'Note|Alias', true], ['vaD', '![[Note|Alias]]', 5, '[[Note|Alias]]', true], ['vio', '["hello"]', 4, '"hello"', true]]);
    addObjects('arguments', [['via', 'f(first, nested("a,b", [1,2]), last)', 12, 'nested("a,b", [1,2])', true], ['vaa', 'f(first, last)', 10, ', last', true], ['vif', 'obj.fn(one, two)', 8, 'one, two', true], ['vaf', 'obj.fn(one, two)', 8, 'obj.fn(one, two)', true]]);
    addObjects('keyValue', [['vik', '备注: 下周处理', 5, '备注', true], ['viv', '备注: 下周处理', 0, '下周处理', true], ['vav', 'a = "hello",', 6, '"hello",', true], ['div', '10:30', 1, '10:30']]);
    addObjects('indentation', [['dii', 'parent\n  one\n    child\n  two\nafter', 19, 'parent\n  one\n  two\nafter'], ['dai', '```yaml\n  one\n  two\n```\nafter', 12, '```yaml\n```\nafter'], ['dig', 'parent\n  body\nafter\n\nnext', 10, '\nnext'], ['dag', 'parent\n  body\nafter\n\nnext', 10, 'next']]);
    addObjects('custom', [['di?BEGIN<CR>END<CR>', 'BEGINoldEND', 6, 'BEGINEND'], ['vi?**<CR>**<CR>', '**hello**', 4, 'hello', true], ['di?BEGIN<CR><Esc>', 'BEGINoldEND', 6, 'BEGINoldEND']]);
    if (plugin.settings?.navigation !== false) fixtures.push(['vinq', '"one"\n"two"', 1, 'two', true], ['din)', 'before\n(hello)', 0, 'before\n()']);
    if (plugin.settings?.url) fixtures.push(['vL', '[link](https://example.com/a(b)).', 12, 'https://example.com/a(b)', true]);
    if (plugin.settings?.whitespace) fixtures.push(['vI(', '(  body  ) tail', 5, 'body', true], ['vA(', '(  body  ) tail', 5, '(  body  ) ', true]);
    if (plugin.settings?.buffer) fixtures.push(['dgG', 'one\ntwo', 2, '']);
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
      await reset('NEW one two'); await keys('yiwwgriww.');
      results.push({ mode: live ? 'live-preview' : 'source', command: 'gr + repeat', passed: editor.getValue() === 'NEW NEW NEW', actual: editor.getValue() });
      results.push({ mode: live ? 'live-preview' : 'source', command: 'gr preserves register', passed: registers.getRegister('"').toString() === 'NEW' });
      await keys('u');
      results.push({ mode: live ? 'live-preview' : 'source', command: 'gr atomic undo', passed: editor.getValue() === 'NEW NEW two', actual: editor.getValue() });
      await keys('<C-r>');
      results.push({ mode: live ? 'live-preview' : 'source', command: 'gr redo', passed: editor.getValue() === 'NEW NEW NEW', actual: editor.getValue() });
      const tableTrigger = plugin.settings?.bindings.T ?? 'T';
      if (plugin.settings?.groups.tables && tableTrigger) {
        const text = '| Name | Value |\n| --- | --- |\n| alpha | one |\n| beta | two |\n';
        for (const command of ['yi' + tableTrigger, 'vi' + tableTrigger]) {
          await reset(text, text.indexOf('alpha'));
          await keys(command);
          if (command.startsWith('v')) {
            // Let live preview reconcile the editor before the copy key.
            await new Promise(resolve => setTimeout(resolve, 80));
            await keys('y');
          }
          const actual = registers.getRegister('"').toString();
          // Entering a rendered cell may normalize table alignment whitespace.
          const expected = editor.getValue();
          results.push({ mode: live ? 'live-preview' : 'source', command: command + (command.startsWith('v') ? ' + delayed y' : ''), expected, actual, passed: actual === expected && registers.getRegister('"').linewise });
        }
      }
    }
    return { runtime: app.getVersion?.() ?? win.require('obsidian').apiVersion, testedAt: new Date().toISOString(), skippedObjectGroups, passed: results.filter(r => r.passed).length, results };
  } finally {
    restoreRegisters?.();
    // Flush the pending Markdown save before trashing the disposable file.
    // Otherwise its delayed save may recreate the file after deletion.
    await view?.save?.();
    leaf.detach();
    if (original) app.workspace.setActiveLeaf(original, { focus: true });
    await app.vault.trash(file, false);
  }
}
