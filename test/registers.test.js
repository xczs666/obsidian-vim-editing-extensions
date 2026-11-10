import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerEdit } from '../src/registers.js';

test('register replacement normalizes line endings to the target mode', () => {
  for (const [text, from, to, value, registerLinewise, linewise, expected, cursor] of [
    ['old tail', 0, 3, 'new', false, false, 'new tail', 0],
    ['old tail', 0, 3, 'new\n', true, false, 'new tail', 0],
    ['old tail', 0, 3, 'one\ntwo\n', true, false, 'one\ntwo tail', 0],
    ['old\nnext', 0, 4, '  new', false, true, '  new\nnext', 2],
    ['old\nnext', 0, 4, 'new\n', true, true, 'new\nnext', 0],
    ['old\n', 0, 4, 'new\n', true, true, 'new\n', 0],
    ['old', 0, 3, 'new\n', true, true, 'new', 0],
    ['old', 0, 3, 'one\ntwo\n', true, true, 'one\ntwo', 0],
    ['""', 1, 1, '中文😀', false, false, '"中文😀"', 1],
    ['old\nnext', 0, 4, '\n', true, true, '\nnext', 0],
  ]) {
    const edit = registerEdit(text, from, to, value, registerLinewise, linewise);
    assert.equal(text.slice(0, edit.from) + edit.insert + text.slice(edit.to), expected);
    assert.equal(edit.cursor, cursor);
  }
  assert.equal(registerEdit('old', 0, 3, '', false, false), null);
});
