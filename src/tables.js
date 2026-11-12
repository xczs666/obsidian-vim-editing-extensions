// Deliberately limited to ordinary pipe tables, outside fenced/indented code,
// frontmatter and block quotes. No rendered HTML or language source is parsed.
function cells(line) {
  if (/^(?: {4}|\t| {0,3}>)/.test(line)) return null;
  const pipes = [];
  for (let i = 0; i < line.length; i++) if (line[i] === '|') {
    let slashes = 0;
    for (let j = i - 1; j >= 0 && line[j] === '\\'; j--) slashes++;
    if (!(slashes % 2)) pipes.push(i);
  }
  if (!pipes.length) return null;
  const result = [];
  let start = 0;
  for (const end of pipes) { result.push(line.slice(start, end).trim()); start = end + 1; }
  result.push(line.slice(start).trim());
  if (!result[0]) result.shift();
  if (!result.at(-1)) result.pop();
  return result;
}

function bodyRow(line) {
  return !!line.trim() && !/^(?: {4}|\t| {0,3}(?:>|#{1,6}(?:\s|$)|`{3,}|~{3,}|[-+*]\s|\d+[.)]\s|<(?:!--|(?:script|pre|style|textarea|div|table)\b)))/i.test(line) &&
    !/^ {0,3}(?:[-*_]\s*){3,}$/.test(line);
}

export function tableAt(text, at, variant = 'i') {
  let offset = 0, fence = null, frontmatter = /^(?:---)\r?(?:\n|$)/.test(text);
  const rows = text.split('\n').map(value => {
    const row = { from: offset, end: offset + value.length, value: value.replace(/\r$/, '') };
    offset += value.length + 1;
    row.to = Math.min(offset, text.length);
    return row;
  });
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i], token = r.value.match(/^ {0,3}(`{3,}|~{3,})(.*)$/);
    if (frontmatter) {
      if (i > 0 && /^(---|\.\.\.)\s*$/.test(r.value)) frontmatter = false;
      continue;
    }
    if (token) {
      if (!fence) fence = token[1];
      else if (token[1][0] === fence[0] && token[1].length >= fence.length && !token[2].trim()) fence = null;
      continue;
    }
    if (fence) continue;
    const header = cells(r.value), separator = rows[i + 1] && cells(rows[i + 1].value);
    if (!header?.length || header.length !== separator?.length || !separator.every(v => /^:?-+:?$/.test(v))) continue;
    let last = i + 1;
    // GFM permits body rows with missing cells, including rows without a pipe.
    // Stop at a blank line or a new block, rather than silently truncating them.
    while (rows[last + 1] && bodyRow(rows[last + 1].value)) last++;
    const tableFrom = r.from, tableTo = rows[last].to;
    if (at >= tableFrom && (at < tableTo || (at === tableTo && tableTo === text.length))) {
      let from = tableFrom, to = tableTo;
      if (variant === 'a') {
        if (rows[last + 1] && !rows[last + 1].value.trim()) to = rows[last + 1].to;
        else if (i > 0 && !rows[i - 1].value.trim()) from = rows[i - 1].from;
      }
      return { from, to, tableFrom, tableTo, linewise: true };
    }
    i = last;
  }
  return null;
}
