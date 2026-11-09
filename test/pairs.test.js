import assert from 'node:assert/strict';
import { test } from 'node:test';
import { collectPairs, findPair, editPair, wrapRange, visualPair, tagPair } from '../src/pairs.js';

test('quoted delimiters, escapes and UTF-16 offsets', () => {
  const text = '前缀 "a\\"b😀" 后缀';
  const p = findPair(text, 8, 8, 'q');
  assert.equal(text.slice(p.innerStart, p.innerEnd), 'a\\"b😀');
  assert.equal(editPair(text, p).insert, 'a\\"b😀');
  assert.equal(findPair("'a\nb'", 2, 2, 'q'), null);
});

test('auto surroundings choose innermost pair and count outward', () => {
  const text = '<p>["hello"]</p>';
  const at = text.indexOf('hello');
  assert.equal(findPair(text, at, at, 'b').kind, '"');
  assert.equal(findPair(text, at, at, 'b', 2).kind, '[');
  assert.equal(findPair(text, at, at, 'b', 3).kind, 't');
  assert.equal(findPair(text, at, at, 'b', 4), null);
});

test('balanced brackets span lines and ignore bracket literals in strings', () => {
  const text = '(\n "ignore )"\n [hello]\n)';
  const p = findPair(text, text.indexOf('hello'), undefined, '(');
  assert.equal(text.slice(p.innerStart, p.innerEnd), '\n "ignore )"\n [hello]\n');
});

test('same-name tags, quoted > attributes, comments, void and malformed tags', () => {
  const text = '<a title="a > b"><a>hello</a></a>';
  const at = text.indexOf('hello');
  assert.equal(editPair(text, findPair(text, at, at, 't')).insert, 'hello');
  assert.equal(editPair(text, findPair(text, at, at, 't', 2)).insert, '<a>hello</a>');
  assert.equal(collectPairs('<!-- <a>hidden</a> -->').filter(p => p.kind === 't').length, 0);
  for (const source of ['<br>', '<img src="x"/>', '<a><b>bad</a></b>', '<a>missing']) {
    assert.equal(collectPairs(source).filter(p => p.kind === 't').length, 0, source);
  }
});

test('forward seeking is limited to current line', () => {
  assert.equal(findPair('before "hello"', 0, 0, 'q').start, 7);
  assert.equal(findPair('before\n"hello"', 0, 0, 'q'), null);
  assert.equal(findPair('"hello" after', 10, 10, 'q'), null);
});

test('empty content remains an editable inner range', () => {
  const p = findPair('""', 0, 0, 'q');
  assert.equal(p.innerStart, p.innerEnd);
  assert.equal(editPair('""', p).insert, '');
});

test('tag input preserves attributes without treating input as HTML', () => {
  assert.deepEqual(tagPair('span class="x"'), ['<span class="x">', '</span>']);
  assert.deepEqual(tagPair('x:item title="a > b"'), ['<x:item title="a > b">', '</x:item>']);
  for (const input of ['', 'br', 'img/', 'span\nfoo', '<span>', 'span title="unclosed']) assert.equal(tagPair(input), null, input);
});

test('wrapping preserves whitespace and puts linewise delimiters on separate lines', () => {
  assert.equal(wrapRange('hello', 0, 5, ['(', ')'], 2).insert, '((hello))');
  assert.equal(wrapRange('hello\nworld\n', 0, 12, ['(', ')'], 1, true).insert, '(\nhello\nworld\n)\n');
  assert.equal(editPair('( hello )', findPair('( hello )', 4, 4, '(')).insert, ' hello ');
});

test('visual edits require full boundary pairs and remove counted layers', () => {
  assert.equal(visualPair('((hello))', 0, 9, 2).insert, 'hello');
  assert.equal(visualPair('((hello))', 0, 9, 2, ['[', ']']).insert, '[[hello]]');
  assert.equal(visualPair('(hello)', 1, 6), null);
  assert.equal(visualPair('hello', 0, 5), null);
});
