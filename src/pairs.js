// All offsets are UTF-16 offsets, matching CodeMirror and Obsidian's Editor API.
export const DELIMITERS = Object.freeze({
  '(': ['(', ')'], ')': ['(', ')'], '[': ['[', ']'], ']': ['[', ']'],
  '{': ['{', '}'], '}': ['{', '}'], '<': ['<', '>'], '>': ['<', '>'],
  '"': ['"', '"'], "'": ["'", "'"], '`': ['`', '`'],
});
export const TARGETS = [...Object.keys(DELIMITERS), 't', 'T', 'b'];
const VOID_TAGS = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));

function escaped(text, index) {
  let slashes = 0;
  while (index > 0 && text[--index] === '\\') slashes++;
  return slashes % 2 === 1;
}

function pair(kind, start, innerStart, innerEnd, end) {
  return { kind, start, innerStart, innerEnd, end };
}

export function collectPairs(text) {
  const result = [];
  const quoted = [];
  for (const quote of ['"', "'", '`']) {
    let start = -1;
    for (let i = 0; i < text.length; i++) {
      if (text[i] === '\n') { start = -1; continue; }
      if (text[i] !== quote || escaped(text, i)) continue;
      if (start < 0) start = i;
      else {
        result.push(pair(quote, start, start + 1, i, i + 1));
        quoted.push([start, i + 1]);
        start = -1;
      }
    }
  }
  // A bracket inside a quoted string is literal, not a nesting delimiter.
  quoted.sort((a, b) => a[0] - b[0] || b[1] - a[1]);
  const stacks = { '(': [], '[': [], '{': [], '<': [] };
  const closing = { ')': '(', ']': '[', '}': '{', '>': '<' };
  let quoteIndex = 0;
  for (let i = 0; i < text.length; i++) {
    while (quoteIndex < quoted.length && quoted[quoteIndex][1] <= i) quoteIndex++;
    if (quoted[quoteIndex]?.[0] <= i && i < quoted[quoteIndex][1]) {
      i = quoted[quoteIndex][1] - 1;
      continue;
    }
    if (escaped(text, i)) continue;
    const ch = text[i];
    if (stacks[ch]) stacks[ch].push(i);
    else if (closing[ch] && stacks[closing[ch]].length) {
      const start = stacks[closing[ch]].pop();
      result.push(pair(closing[ch], start, start + 1, i, i + 1));
    }
  }
  // Tokenize without a DOM parser: preserve source bytes, quoted '>', and nesting.
  const tokens = /<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?[\s\S]*?\?>|<![^>]*>|<\/?([A-Za-z][\w:.-]*)(?=[\s/>])(?:[^<>"']|"[^"]*"|'[^']*')*>/g;
  const tags = [];
  for (const token of text.matchAll(tokens)) {
    if (!token[1]) continue;
    const raw = token[0];
    const name = token[1];
    const start = token.index;
    if (raw.startsWith('</')) {
      const open = tags.pop();
      if (!open || open.name !== name) { tags.length = 0; continue; }
      result.push(pair('t', open.start, open.end, start, start + raw.length));
    } else if (!raw.endsWith('/>') && !VOID_TAGS.has(name.toLowerCase())) {
      tags.push({ name, start, end: start + raw.length });
    }
  }
  return result;
}

export function matchesType(candidate, type) {
  if (type === 'b') return true;
  if (type === 'q') return ['"', "'", '`'].includes(candidate.kind);
  if (type === 't' || type === 'T') return candidate.kind === 't';
  return candidate.kind === DELIMITERS[type]?.[0];
}

export function findPair(text, start, end = start, type = 'b', count = 1, exclude = null) {
  const pairs = collectPairs(text).filter(p => matchesType(p, type));
  const covering = pairs.filter(p => p.start <= start && p.end > start && p.end >= end)
    .filter(p => !exclude || p.start !== exclude.start || p.end !== exclude.end)
    .sort((a, b) => (a.end - a.start) - (b.end - b.start) || b.start - a.start);
  if (covering.length) return covering[count - 1] ?? null;
  // Only seek forward on the current line. Never edit an unrelated later line.
  const newline = text.indexOf('\n', start);
  const lineEnd = newline < 0 ? text.length : newline;
  const next = pairs.filter(p => p.start >= end && p.start < lineEnd)
    .sort((a, b) => a.start - b.start || (a.end - a.start) - (b.end - b.start));
  return next[count - 1] ?? null;
}

export function tagPair(input) {
  const value = input.trim();
  const match = /^([A-Za-z][\w:.-]*)(?=$|\s)(?:[^<>"']|"[^"\n]*"|'[^'\n]*')*$/.exec(value);
  if (!match || /[\r\n]/.test(value) || /\/\s*$/.test(value) || VOID_TAGS.has(match[1].toLowerCase())) return null;
  return [`<${value}>`, `</${match[1]}>`];
}

export function editPair(text, candidate, replacement = ['', '']) {
  return {
    from: candidate.start,
    to: candidate.end,
    insert: replacement[0] + text.slice(candidate.innerStart, candidate.innerEnd) + replacement[1],
    cursor: candidate.start,
  };
}

export function wrapRange(text, from, to, replacement, count = 1, linewise = false) {
  let content = text.slice(from, to);
  let suffix = '';
  if (linewise) {
    // Leave the existing final newline outside the replacement range's wrapper.
    if (content.endsWith('\n')) { content = content.slice(0, -1); suffix = '\n'; }
    return { from, to, insert: replacement[0].repeat(count) + '\n' + content + '\n' + replacement[1].repeat(count) + suffix, cursor: from };
  }
  return { from, to, insert: replacement[0].repeat(count) + content + replacement[1].repeat(count), cursor: from };
}

export function visualPair(text, from, to, count = 1, replacement = ['', '']) {
  let content = text.slice(from, to);
  let prefix = '';
  let suffix = '';
  if (/^\s*\n/.test(content)) { const m = /^\s*\n/.exec(content)[0]; prefix = m; content = content.slice(m.length); }
  if (/\n\s*$/.test(content)) { const m = /\n\s*$/.exec(content)[0]; suffix = m; content = content.slice(0, -m.length); }
  for (let i = 0; i < count; i++) {
    const p = collectPairs(content).find(p => p.start === 0 && p.end === content.length);
    if (!p) return null;
    content = content.slice(p.innerStart, p.innerEnd);
  }
  return { from, to, insert: prefix + replacement[0].repeat(count) + content + replacement[1].repeat(count) + suffix, cursor: from };
}
