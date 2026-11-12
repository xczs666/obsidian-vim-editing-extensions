import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveObject, SEPARATORS } from '../src/objects.js';
import { objectMappings, normalizeSettings } from '../src/object-settings.js';

function selected(text, request) {
  const result = resolveObject(text, request);
  return result && text.slice(result.from, result.to);
}

test('all explicit separators support first/last segments, runs, counts and literal matching', () => {
  for (const ch of SEPARATORS) {
    const text = `foo${ch}${ch}bar${ch}baz`;
    assert.equal(selected(text, { id: 'sep:' + ch, head: 0 }), 'foo', JSON.stringify(ch));
    assert.equal(selected(text, { id: 'sep:' + ch, head: 0, variant: 'a' }), `foo${ch}${ch}`);
    assert.equal(selected(text, { id: 'sep:' + ch, head: 3 }), 'bar');
    assert.equal(selected(text, { id: 'sep:' + ch, head: text.length - 1, variant: 'a' }), `${ch}baz`);
    assert.equal(selected(text, { id: 'sep:' + ch, head: 0, count: 2 }), `foo${ch}${ch}bar`);
    assert.equal(resolveObject(text, { id: 'sep:' + ch, head: 0, count: 4 }), null);
    assert.equal(resolveObject('no separator', { id: 'sep:' + ch, head: 0 }) === null, ch !== ' ');
  }
  assert.equal(selected('a,"b,c",d', { id: 'sep:,', head: 3 }), '"b');
  assert.equal(selected('one_two\nthree_four', { id: 'sep:_', head: 2 }), 'one');
});

test('line and subword objects keep the requested characters and Unicode intact', () => {
  assert.equal(selected('\t body  \nnext', { id: 'L', head: 3 }), 'body');
  assert.equal(selected('\t body  \nnext', { id: 'L', head: 3, variant: 'a' }), '\t body  ');
  assert.equal(selected('  a \n b \nend', { id: 'L', head: 2, count: 2 }), 'a \n b');
  const text = 'XMLParser42 snake_case kebab-case 中文😀';
  for (const [head, value] of [[0, 'XML'], [3, 'Parser'], [9, '42'], [13, 'snake'], [19, 'case'], [25, 'kebab'], [30, 'case'], [34, '中文']]) {
    assert.equal(selected(text, { id: 'S', head }), value, head);
  }
});

test('paired objects and whitespace variants distinguish double links and bracket alias', () => {
  const text = '![[Note#Heading|Alias]]';
  assert.equal(selected(text, { id: 'D', head: 5 }), 'Note#Heading|Alias');
  assert.equal(selected(text, { id: 'D', head: 5, variant: 'a' }), '[[Note#Heading|Alias]]');
  assert.equal(selected('["hello"]', { id: 'o', head: 4 }), '"hello"');
  assert.equal(selected('["hello"]', { id: 'b', head: 4 }), 'hello');
  assert.equal(resolveObject('<b>hello</b>', { id: 'o', head: 5 }), null);
  assert.equal(selected('x (  body  )  y', { id: 'pair:(', head: 6, variant: 'I' }), 'body');
  assert.equal(selected('x (  body  )  y', { id: 'pair:(', head: 6, variant: 'A' }), '(  body  )  ');
  assert.equal(selected('one_bar_two', { id: 'sep:_', head: 5, variant: 'A' }), '_bar_');
});

test('argument and call scanners skip nested containers, escaped strings and control keywords', () => {
  const text = 'obj.run(first, inner("a,b", [1, 2]), last)';
  assert.equal(selected(text, { id: 'a', head: text.indexOf('inner') }), 'inner("a,b", [1, 2])');
  assert.equal(selected(text, { id: 'a', head: text.indexOf('first'), variant: 'a' }), 'first, ');
  assert.equal(selected(text, { id: 'a', head: text.indexOf('last'), variant: 'a' }), ', last');
  assert.equal(selected(text, { id: 'f', head: text.indexOf('a,b') }), '"a,b", [1, 2]');
  assert.equal(selected(text, { id: 'f', head: text.indexOf('last'), variant: 'a' }), text);
  assert.equal(selected('f()', { id: 'a', head: 1 }), '');
  assert.equal(resolveObject('if (ready)', { id: 'f', head: 5 }), null);
  assert.equal(resolveObject('function run(a) { }', { id: 'f', head: 13 }), null);
  assert.equal(resolveObject('f("unclosed)', { id: 'a', head: 4 }), null);
});

test('key/value objects work on ordinary labels but exclude time, URL, comparison and unsupported values', () => {
  for (const [text, key, value, outerKey, outerValue] of [
    ['备注: 下周处理', '备注', '下周处理', '备注: ', '下周处理'],
    ['  "name": "hello",', '"name"', '"hello"', '"name": ', '"hello",'],
    ['count = 42;', 'count', '42', 'count = ', '42;'],
    ['url: https://example.com/a:b', 'url', 'https://example.com/a:b', 'url: ', 'https://example.com/a:b'],
  ]) {
    assert.equal(selected(text, { id: 'k', head: 1 }), key, text);
    assert.equal(selected(text, { id: 'v', head: 1 }), value, text);
    assert.equal(selected(text, { id: 'k', head: 1, variant: 'a' }), outerKey, text);
    assert.equal(selected(text, { id: 'v', head: 1, variant: 'a' }), outerValue, text);
  }
  for (const text of ['10:30', 'https://example.com', 'a == b', 'a != b', 'a <= b', 'a => b', 'a: |', '{"a": 1, "b": 2}', 'a=[1,2', 'ordinary prose']) {
    assert.equal(resolveObject(text, { id: 'v', head: 0 }), null, text);
  }
  assert.equal(selected('备注: keep #tag', { id: 'v', head: 0 }), 'keep #tag');
  assert.equal(selected('---\nname: value # comment\n---', { id: 'v', head: 5 }), 'value');
  assert.equal(selected('```js\nname = "value"; // comment\n```', { id: 'v', head: 8 }), '"value"');
});

test('indentation is linewise, counts outward and never crosses fences/frontmatter', () => {
  const text = 'parent\n  one\n    child\n  two\nafter\n';
  assert.equal(selected(text, { id: 'i', head: text.indexOf('child') }), '    child\n');
  assert.equal(selected(text, { id: 'i', head: text.indexOf('child'), count: 2 }), '  one\n    child\n  two\n');
  assert.equal(selected(text, { id: 'i', head: text.indexOf('one'), variant: 'a' }), 'parent\n  one\n    child\n  two\n');
  assert.equal(selected(text, { id: 'I', head: text.indexOf('one'), variant: 'a' }), text);
  const fenced = 'before\n```yaml\n  one\n  two\n```\nafter';
  assert.equal(selected(fenced, { id: 'i', head: fenced.indexOf('one') }), '  one\n  two\n');
  assert.equal(selected(fenced, { id: 'I', head: fenced.indexOf('one'), variant: 'a' }), '  one\n  two\n');
  const frontmatter = '---\nname: a\n  child: b\n---\nbody';
  assert.ok(!selected(frontmatter, { id: 'i', head: frontmatter.indexOf('child'), variant: 'a' }).includes('---'));
  const tabs = 'parent\n\tone\n        child\n\tpeer\nafter';
  assert.equal(selected(tabs, { id: 'i', head: tabs.indexOf('child'), tabSize: 4 }), '        child\n');
  assert.equal(selected(tabs, { id: 'i', head: tabs.indexOf('child'), tabSize: 8 }), '\tone\n        child\n\tpeer\n');
});

test('next/previous, incremental expansion, literal custom boundaries, URLs and entire file', () => {
  const text = '"one"\n"two"\n"three"';
  assert.equal(selected(text, { id: 'q', head: 1, direction: 'next' }), 'two');
  assert.equal(selected(text, { id: 'q', head: 1, direction: 'next', count: 2 }), 'three');
  assert.equal(selected(text, { id: 'q', head: 9, direction: 'previous' }), 'one');
  assert.equal(selected('one_two_three', { id: 'sep:_', head: 1, selection: { from: 0, to: 3 }, expand: true }), 'one_two');
  assert.equal(selected('one_two_three_four_five', { id: 'sep:_', head: 1, selection: { from: 0, to: 3 }, expand: true, count: 3 }), 'one_two_three_four');
  assert.equal(selected('([hello])', { id: 'b', head: 5, selection: { from: 2, to: 7 }, expand: true }), '[hello]');
  assert.equal(selected('BEGIN outer BEGIN inner END tail END', { id: '?', head: 20, markers: ['BEGIN', 'END'] }), ' inner ');
  assert.equal(selected('**hello**', { id: '?', head: 4, markers: ['**', '**'], variant: 'a' }), '**hello**');
  assert.equal(selected('[link](https://example.com/a(b)).', { id: 'url', head: 12 }), 'https://example.com/a(b)');
  assert.equal(selected('obsidian://open?vault=Notes', { id: 'url', head: 5 }), 'obsidian://open?vault=Notes');
  assert.deepEqual(resolveObject('a\nb', { id: 'buffer', head: 2 }), { from: 0, to: 3, linewise: true });
});

test('settings validate complete binding sets and optional mappings stay opt-in', () => {
  assert.doesNotThrow(() => objectMappings(null));
  const base = objectMappings();
  assert.ok(base.some(m => m.keys === 'i_' && m.id === 'sep:_'));
  assert.ok(base.some(m => m.keys === 'i,' && m.id === 'sep:,'));
  assert.ok(base.some(m => m.keys === 'ia' && m.id === 'a'));
  assert.ok(base.some(m => m.keys === 'iL' && m.id === 'L'));
  assert.ok(!base.some(m => ['L', 'gG', 'I('].includes(m.keys)));
  assert.throws(() => objectMappings({ bindings: { L: 'S' } }), /Duplicate/);
  assert.throws(() => objectMappings({ bindings: { L: 'w' } }), /reserved/);
  assert.throws(() => objectMappings({ bindings: { L: 'ab' } }), /Invalid/);
  assert.ok(!objectMappings({ bindings: { L: '' } }).some(m => m.keys === 'iL'));
  assert.ok(objectMappings({ url: true, whitespace: true, buffer: true }).some(m => m.keys === 'I('));
  assert.equal(normalizeSettings({ groups: { separators: false } }).groups.subword, true);
  assert.equal(normalizeSettings({ bindings: { L: 'T' } }).bindings.T, '');
  assert.doesNotThrow(() => objectMappings({ bindings: { L: 'T' } }));
});
