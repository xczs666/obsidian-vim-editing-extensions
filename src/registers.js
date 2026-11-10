/** Build a replacement without changing any Vim register. Offsets are UTF-16. */
export function registerEdit(text, from, to, value, registerLinewise, linewise) {
  if (!value) return null;
  const insideSurrogate = at => at > 0 && at < text.length &&
    /[\uD800-\uDBFF]/.test(text[at - 1]) && /[\uDC00-\uDFFF]/.test(text[at]);
  if (insideSurrogate(from)) from--;
  if (insideSurrogate(to)) to++;
  let insert = registerLinewise && value.endsWith('\n') ? value.slice(0, -1) : value;
  if (linewise && (to < text.length || text.endsWith('\n')) && !insert.endsWith('\n')) insert += '\n';
  const cursor = from + (linewise ? insert.match(/^[^\S\n]*/)[0].length : 0);
  return { from, to, insert, cursor };
}
