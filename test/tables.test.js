import assert from 'node:assert/strict';
import { test } from 'node:test';
import { tableAt } from '../src/tables.js';

const table = '| Name | Value |\n| :--- | ---: |\n| `alpha` | one |\n| beta | two |\n';
test('table ranges contain header, separator and every body row, excluding surrounding prose', () => {
  const text = 'Before\n\n' + table + '\nAfter';
  for (const at of [8, text.indexOf(':---'), text.indexOf('alpha'), text.indexOf('two')]) {
    const r = tableAt(text, at);
    assert.equal(text.slice(r.from, r.to), table);
    assert.equal(r.linewise, true);
  }
  for (const at of [0, 7, text.indexOf('After')]) assert.equal(tableAt(text, at), null);
  assert.equal(tableAt(text, text.indexOf('alpha'), 'a').to, 8 + table.length + 1);
});
test('optional outer pipes, escaped pipes, CRLF and a table at EOF preserve exact Markdown', () => {
  for (const text of ['a | b\n- | -\nx\\|y | z', '| a |\n| - |', table.trimEnd(), table.replaceAll('\n', '\r\n')]) {
    const r = tableAt(text, text.indexOf('a'));
    assert.equal(text.slice(r.from, r.to), text);
  }
});
test('non-tables, fenced examples, frontmatter and indented code are excluded', () => {
  for (const text of ['a | b\nnot a separator', 'Title\n---', 'a | b\n| --- |', '    | a |\n    | - |']) {
    assert.equal(tableAt(text, 0), null, text);
  }
  for (const text of ['```md\n' + table + '```', '~~~~\n' + table + '~~~~', '---\n' + table + '---']) {
    assert.equal(tableAt(text, text.indexOf('alpha')), null);
  }
  assert.equal(tableAt('```\nx\n```\n\n' + table, 18).from, 11);
});

test('body rows with missing cells are retained and following block boundaries are excluded', () => {
  const table = 'a | b\n- | -\nplain row\nlast | two\n';
  for (const ending of ['\nAfter', '# Heading\n', '> Quote\n', '```js | info\nx\n```', '- list | item\n', '<!-- comment | value -->\n']) {
    const text = table + ending;
    const range = tableAt(text, text.indexOf('plain'));
    assert.equal(text.slice(range.from, range.to), table);
  }
});
