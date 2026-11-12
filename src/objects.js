import { collectPairs } from './pairs.js';

export const SEPARATORS = [' ', '_', ',', '-', '.', ';', ':', '+', '=', '~', '*', '/', '\\', '|', '&', '$'];
const horizontal = c => c != null && /[\t ]/.test(c);
const escaped = (text, at) => {
  let n = 0;
  while (at > 0 && text[--at] === '\\') n++;
  return n % 2 === 1;
};
const candidate = (from, to, innerFrom = from, innerTo = to, extra = {}) =>
  ({ from, to, innerFrom, innerTo, aroundFrom: from, aroundTo: to, coverFrom: from, coverTo: to, ...extra });

function linesOf(text, tabSize) {
  let offset = 0;
  const lines = text.split('\n').map(value => {
    let indent = 0;
    for (const ch of value.match(/^[\t ]*/)[0]) indent += ch === '\t' ? tabSize - indent % tabSize : 1;
    const row = { value, from: offset, to: offset + value.length, indent, blank: !value.trim() };
    offset += value.length + 1;
    return row;
  });
  let scope = 0, fence = null, language = '', frontmatter = lines[0]?.value === '---';
  for (let i = 0; i < lines.length; i++) {
    const row = lines[i];
    row.language = frontmatter ? 'yaml' : language;
    if (frontmatter && (i === 0 || /^(---|\.\.\.)\s*$/.test(row.value))) {
      row.scope = null;
      if (i > 0) frontmatter = false;
      scope++;
      continue;
    }
    const token = row.value.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (token && (!fence || (token[1][0] === fence[0] && token[1].length >= fence.length && !token[2].trim()))) {
      row.scope = null;
      language = fence ? '' : token[2].trim().split(/\s/)[0].toLowerCase();
      fence = fence ? null : token[1];
      scope++;
      continue;
    }
    row.scope = scope;
  }
  return lines;
}

/** Shared lexical scanner for arguments/calls. It never evaluates source. */
function structures(text) {
  const brackets = [], strings = [], stack = [];
  let quote = null, quoteStart = 0;
  const closing = { ')': '(', ']': '[', '}': '{' };
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quote) {
      if (ch === quote && !escaped(text, i)) {
        strings.push({ from: quoteStart, to: i + 1 });
        quote = null;
      } else if (ch === '\n' && quote !== '`') {
        for (const item of stack) item.invalid = true;
        quote = null;
      }
      continue;
    }
    if ('\'"`'.includes(ch) && !escaped(text, i)) { quote = ch; quoteStart = i; continue; }
    if ('([{'.includes(ch)) stack.push({ ch, from: i });
    else if (closing[ch]) {
      const open = stack.pop();
      if (!open || open.ch !== closing[ch]) { for (const item of stack) item.invalid = true; continue; }
      if (!open.invalid) brackets.push({ from: open.from, to: i + 1, ch: open.ch });
    }
  }
  return { brackets, strings };
}

function segments(text, start, end, runs, group) {
  const result = [];
  let from = start, left = null;
  for (let i = 0; i <= runs.length; i++) {
    const right = runs[i];
    const to = right?.from ?? end;
    if (to > from) result.push(candidate(left?.from ?? from, right?.to ?? to, from, to, {
      aroundFrom: right ? from : left?.from ?? from,
      aroundTo: right?.to ?? to,
      coverFrom: left?.from ?? from, coverTo: to,
      group, flat: true, boundaryStyle: true, rightBoundary: !!right, leftBoundaryFrom: left?.from ?? from,
    }));
    if (right) { from = right.to; left = right; }
  }
  return result;
}

function separatorObjects(text, delimiter, lines) {
  return lines.flatMap(row => {
    const runs = [];
    for (let i = row.from; i < row.to; i++) {
      if (text[i] !== delimiter) continue;
      const from = i;
      while (text[i + 1] === delimiter) i++;
      runs.push({ from, to: i + 1 });
    }
    return runs.length ? segments(text, row.from, row.to, runs, row.from) : [];
  });
}

function subwords(text, lines) {
  const result = [];
  for (const row of lines) {
    for (const match of row.value.matchAll(/[\p{L}\p{N}]+/gu)) {
      const chars = [...match[0]], cuts = [0];
      let offset = 0;
      for (let i = 0; i < chars.length; i++) {
        const a = chars[i - 1], b = chars[i], c = chars[i + 1];
        if (i && ((/\p{Ll}/u.test(a) && /\p{Lu}/u.test(b)) ||
          (/\p{Lu}/u.test(a) && /\p{Lu}/u.test(b) && c && /\p{Ll}/u.test(c)) ||
          (/\p{N}/u.test(a) !== /\p{N}/u.test(b)))) cuts.push(offset);
        offset += b.length;
      }
      cuts.push(offset);
      for (let i = 0; i < cuts.length - 1; i++) {
        const from = row.from + match.index + cuts[i], to = row.from + match.index + cuts[i + 1];
        let left = from, right = to;
        while (right < row.to && /[_.\-\t ]/.test(text[right])) right++;
        if (right === to) while (left > row.from && /[_.\-\t ]/.test(text[left - 1])) left--;
        result.push(candidate(from, to, from, to, { aroundFrom: left, aroundTo: right, flat: true, group: row.from }));
      }
    }
  }
  return result;
}

function argumentObjects(text, lex) {
  const skip = new Map([...lex.brackets, ...lex.strings].map(p => [p.from, p.to]));
  return lex.brackets.flatMap(container => {
    const commas = [];
    for (let i = container.from + 1; i < container.to - 1; i++) {
      if (skip.has(i)) { i = skip.get(i) - 1; continue; }
      if (text[i] === ',') commas.push(i);
    }
    const bounds = [container.from, ...commas, container.to - 1];
    return bounds.slice(0, -1).map((left, i) => {
      const right = bounds[i + 1];
      let from = left + 1, to = right;
      while (from < to && /\s/.test(text[from])) from++;
      while (to > from && /\s/.test(text[to - 1])) to--;
      let aroundFrom = from, aroundTo = to;
      if (i < commas.length) {
        aroundTo = right + 1;
        while (aroundTo < container.to - 1 && /\s/.test(text[aroundTo])) aroundTo++;
      } else if (i > 0) aroundFrom = left;
      return candidate(left + 1, right, from, to, {
        aroundFrom, aroundTo, coverFrom: i ? left : container.from, coverTo: right,
        flat: true, group: container.from, boundaryStyle: true, rightBoundary: i < commas.length, leftBoundaryFrom: i ? left : from,
      });
    });
  });
}

function callObjects(text, lex) {
  return lex.brackets.filter(p => p.ch === '(').flatMap(p => {
    const match = text.slice(0, p.from).match(/([\p{L}_$][\p{L}\p{N}_$]*(?:\.[\p{L}_$][\p{L}\p{N}_$]*)*)[\t ]*$/u);
    if (!match || /^(if|for|while|switch|catch|with)$/.test(match[1])) return [];
    const from = p.from - match[0].length;
    if (/(?:\bfunction|\bclass|\bdef)\s+$/.test(text.slice(0, from)) || /^\s*(?:=>|\{)/.test(text.slice(p.to))) return [];
    return [candidate(from, p.to, p.from + 1, p.to - 1)];
  });
}

function keyValues(text, lines, id) {
  return lines.flatMap(row => {
    let from = row.from + row.value.match(/^[\t ]*(?:- )?/)[0].length, to = row.to;
    while (to > from && horizontal(text[to - 1])) to--;
    if (text[from] === '{' && text[to - 1] === '}') { from++; to--; }
    const splits = [];
    const commentAt = at =>
      (text[at] === '#' && ['yaml', 'yml', 'bash', 'sh', 'zsh', 'python', 'py'].includes(row.language)) ||
      (text.startsWith('//', at) && ['js', 'javascript', 'ts', 'typescript', 'java', 'c', 'cpp', 'go'].includes(row.language)) ||
      (text.startsWith('--', at) && row.language === 'sql');
    let quote = null, depth = 0, comment = to;
    for (let i = from; i < to; i++) {
      const ch = text[i];
      if (quote) { if (ch === quote && !escaped(text, i)) quote = null; continue; }
      if ('\'"`'.includes(ch) && !escaped(text, i)) { quote = ch; continue; }
      if ('([{'.includes(ch)) depth++;
      else if (')]}'.includes(ch)) depth--;
      else if (!depth && horizontal(text[i - 1]) && commentAt(i)) { comment = i; break; }
      else if (!depth && (ch === ':' || ch === '=')) {
        if (splits.length && /^[\t ]*[A-Za-z][A-Za-z0-9+.-]*:\/\//.test(text.slice(splits[0] + 1))) continue;
        if (ch === ':' && splits.length) continue;
        if (ch === ':' && text.slice(i + 1, i + 3) === '//') return [];
        if (/[!<>=~:]/.test(text[i - 1] ?? '') || /[=>:]/.test(text[i + 1] ?? '')) return [];
        splits.push(i);
      } else if (!depth && (ch === ',' || ch === ';') && text.slice(i + 1, to).trim()) {
        const next = i + 1 + text.slice(i + 1, to).match(/^[\t ]*/)[0].length;
        if (!commentAt(next)) return [];
      }
    }
    if (quote || depth !== 0 || splits.length !== 1) return [];
    const split = splits[0];
    let keyFrom = from, keyTo = split, valueFrom = split + 1, valueTo = comment;
    while (horizontal(text[keyFrom])) keyFrom++;
    while (keyTo > keyFrom && horizontal(text[keyTo - 1])) keyTo--;
    const key = text.slice(keyFrom, keyTo);
    if (!key || !/[\p{L}_]/u.test(key) || !/^(?:[\p{L}\p{N}_.\-\t ]+|"(?:[^"\\]|\\.)*"|'(?:[^'\\]|\\.)*')$/u.test(key)) return [];
    while (valueFrom < valueTo && horizontal(text[valueFrom])) valueFrom++;
    while (valueTo > valueFrom && horizontal(text[valueTo - 1])) valueTo--;
    const outerTo = valueTo;
    if (/[,;]/.test(text[valueTo - 1] ?? '')) valueTo--;
    while (valueTo > valueFrom && horizontal(text[valueTo - 1])) valueTo--;
    if (/^[|>][-+0-9]*$/.test(text.slice(valueFrom, valueTo))) return [];
    return [id === 'k'
      ? candidate(keyFrom, valueFrom, keyFrom, keyTo, { coverFrom: row.from, coverTo: row.to })
      : candidate(valueFrom, outerTo, valueFrom, valueTo, { coverFrom: row.from, coverTo: row.to })];
  });
}

function indentation(text, lines, id) {
  const result = new Map(), seen = new Set();
  const bounds = new Map(), lowerLeft = [], lowerRight = [], blankLeft = [], blankRight = [];
  for (let i = 0; i < lines.length; i++) {
    const scope = lines[i].scope;
    if (scope != null) { if (!bounds.has(scope)) bounds.set(scope, [i, i]); else bounds.get(scope)[1] = i; }
  }
  for (const forward of [true, false]) {
    let stack = [], scope, blank = forward ? -1 : lines.length;
    for (let step = 0; step < lines.length; step++) {
      const i = forward ? step : lines.length - step - 1, row = lines[i];
      if (row.scope == null || row.scope !== scope) { stack = []; scope = row.scope; }
      if (row.blank || row.scope == null) blank = i;
      (forward ? blankLeft : blankRight)[i] = blank;
      if (row.blank || row.scope == null) continue;
      while (stack.length && lines[stack.at(-1)].indent >= row.indent) stack.pop();
      const edge = bounds.get(row.scope);
      (forward ? lowerLeft : lowerRight)[i] = stack.at(-1) ?? (forward ? edge[0] - 1 : edge[1] + 1);
      stack.push(i);
    }
  }
  for (let i = 0; i < lines.length; i++) {
    const row = lines[i];
    if (row.blank || row.scope == null) continue;
    let lo = lowerLeft[i] + 1, hi = lowerRight[i] - 1;
    const within = j => j >= 0 && j < lines.length && lines[j].scope === row.scope;
    if (!row.indent) { lo = Math.max(lo, blankLeft[i] + 1); hi = Math.min(hi, blankRight[i] - 1); }
    while (lines[lo]?.blank) lo++;
    while (lines[hi]?.blank) hi--;
    const blockKey = `${row.scope}:${lo}:${hi}`;
    if (seen.has(blockKey)) continue;
    seen.add(blockKey);
    let outerLo = within(lo - 1) ? lo - 1 : lo, outerHi = id === 'I' && within(hi + 1) ? hi + 1 : hi;
    if (id === 'g') {
      const first = lines[outerLo].blank ? lo : outerLo;
      const next = within(hi + 1) && !lines[hi + 1].blank ? hi + 1 : hi;
      lo = Math.max(bounds.get(row.scope)[0], blankLeft[first] + 1);
      hi = Math.min(bounds.get(row.scope)[1], blankRight[next] - 1);
      outerLo = lo; outerHi = hi;
      if (within(hi + 1) && lines[hi + 1].blank) outerHi++;
      else if (within(lo - 1) && lines[lo - 1].blank) outerLo--;
    }
    const after = j => Math.min(text.length, lines[j].to + 1);
    const p = candidate(lines[outerLo].from, after(outerHi), lines[lo].from, after(hi), { linewise: true, coverFrom: lines[lo].from, coverTo: after(hi) });
    result.set([p.from, p.to, p.innerFrom, p.innerTo].join(':'), p);
  }
  return [...result.values()];
}

function literalPairs(text, left, right) {
  if (!left || !right || /[\r\n]/.test(left + right)) return [];
  const result = [], stack = [];
  for (let i = 0; i < text.length;) {
    if (left === right && text.startsWith(left, i)) {
      if (stack.length) { const open = stack.pop(); result.push(candidate(open, i + right.length, open + left.length, i)); }
      else stack.push(i);
      i += left.length;
    } else if (text.startsWith(right, i) && stack.length) {
      const open = stack.pop(); result.push(candidate(open, i + right.length, open + left.length, i)); i += right.length;
    } else if (text.startsWith(left, i)) { stack.push(i); i += left.length; }
    else i++;
  }
  return result;
}

function urls(text) {
  return [...text.matchAll(/[A-Za-z][A-Za-z0-9+.-]*:\/\/[^\s<>"'`]+/g)].map(match => {
    let value = match[0];
    for (;;) {
      while (/[.,;:!?，。；：！？]$/.test(value)) value = value.slice(0, -1);
      const close = value.at(-1), open = { ')': '(', ']': '[', '}': '{' }[close];
      if (!open || [...value].filter(c => c === close).length <= [...value].filter(c => c === open).length) break;
      value = value.slice(0, -1);
    }
    return candidate(match.index, match.index + value.length);
  });
}

function candidates(text, request) {
  const { id } = request;
  const lines = linesOf(text, request.tabSize || 4);
  if (id.startsWith('sep:')) return separatorObjects(text, id.slice(4), lines);
  if (id === 'S') return subwords(text, lines);
  if (id === 'L') return lines.map(row => {
    const leading = row.value.match(/^[\t ]*/)[0].length;
    const trailing = row.value.match(/[\t ]*$/)[0].length;
    return candidate(row.from, row.to, row.from + leading, Math.max(row.from + leading, row.to - trailing), { flat: true, group: 'lines' });
  });
  if (id === 'i' || id === 'I' || id === 'g') return indentation(text, lines, id);
  if (id === 'k' || id === 'v') return keyValues(text, lines, id);
  if (id === 'a' || id === 'f') {
    const lex = structures(text);
    return id === 'a' ? argumentObjects(text, lex) : callObjects(text, lex);
  }
  if (id === '?') return literalPairs(text, ...(request.markers ?? []));
  if (id === 'url') return urls(text);
  if (id === 'buffer') return [candidate(0, text.length, 0, text.length, { linewise: true })];
  const pairs = collectPairs(text);
  if (id === 'D') return literalPairs(text, '[[', ']]');
  return pairs.filter(p => id === 'b' || (id === 'q' && ['"', "'", '`'].includes(p.kind)) ||
    (id === 'o' && ['(', '[', '{'].includes(p.kind)) ||
    (id.startsWith('pair:') && p.kind === ({ ')': '(', ']': '[', '}': '{', '>': '<', B: '{' }[id.slice(5)] ?? id.slice(5))))
    .map(p => candidate(p.start, p.end, p.innerStart, p.innerEnd));
}

function region(text, p, variant) {
  let from = variant === 'i' || variant === 'I' ? p.innerFrom : variant === 'a' ? p.aroundFrom : p.from;
  let to = variant === 'i' || variant === 'I' ? p.innerTo : variant === 'a' ? p.aroundTo : p.to;
  if (variant === 'I') {
    while (from < to && /\s/.test(text[from])) from++;
    while (to > from && /\s/.test(text[to - 1])) to--;
  } else if (variant === 'A') {
    while (horizontal(text[to])) to++;
    if (to === p.to) while (from > 0 && horizontal(text[from - 1])) from--;
  }
  return { from, to, linewise: !!p.linewise };
}

/** Resolve one complete request; no Vim state, DOM access or document writes. */
export function resolveObject(text, request) {
  const { id, head = 0, selection, expand = false, variant = 'i', direction = 'current' } = request;
  const count = Math.max(1, request.count || 1);
  const all = candidates(text, request);
  const position = selection?.from ?? head;
  const end = selection?.to ?? head;
  if (direction !== 'current') {
    const forward = direction === 'next';
    const distant = all.filter(p => forward ? p.coverFrom > end || (selection && p.coverFrom === end) : p.coverTo <= position)
      .sort((a, b) => forward ? a.coverFrom - b.coverFrom || a.to - a.from - (b.to - b.from) : b.coverTo - a.coverTo || a.to - a.from - (b.to - b.from));
    return distant[count - 1] ? region(text, distant[count - 1], variant) : null;
  }
  let matching = all.filter(p => p.coverFrom <= head && (head < p.coverTo || (head === text.length && p.coverTo === head) || p.coverFrom === p.coverTo && p.coverFrom === head));
  if (expand && selection) {
    matching = all.filter(p => {
      const r = region(text, p, variant);
      if (p.flat) return r.from === selection.from;
      return r.from <= selection.from && r.to >= selection.to && (r.from < selection.from || r.to > selection.to || p.flat);
    });
  }
  matching.sort((a, b) => a.to - a.from - (b.to - b.from) || b.from - a.from);
  if (!matching.length && !expand) {
    const lineEnd = text.indexOf('\n', head);
    matching = all.filter(p => p.coverFrom >= head && p.coverFrom <= (lineEnd < 0 ? text.length : lineEnd)).sort((a, b) => a.coverFrom - b.coverFrom || a.to - a.from - (b.to - b.from));
  }
  const first = matching[0];
  if (!first) return null;
  if (first.flat) {
    const siblings = all.filter(p => p.flat && p.group === first.group).sort((a, b) => a.innerFrom - b.innerFrom);
    const start = siblings.indexOf(first);
    let last = start + count - 1;
    if (expand && selection) {
      last = start;
      while (last < siblings.length && region(text, siblings[last], variant).to <= selection.to) last++;
      last += count - 1;
    }
    if (!siblings[last]) return null;
    return region(text, { ...first, to: siblings[last].to, innerTo: siblings[last].innerTo,
      aroundFrom: first.boundaryStyle ? (siblings[last].rightBoundary ? first.innerFrom : first.leftBoundaryFrom) : first.aroundFrom,
      aroundTo: siblings[last].aroundTo }, variant);
  }
  // Nested objects count outward. Single candidates do not repeat inserted text.
  const ordered = matching.filter(p => p.coverFrom <= position && p.coverTo >= end);
  const selected = (ordered.length ? ordered : matching)[count - 1];
  if (!selected || (id === 'buffer' && count > 1)) return null;
  return region(text, selected, variant);
}
