import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import vm from 'node:vm';

export function installDOM() {
  const dom = new JSDOM('<!doctype html><html><body></body></html>', { pretendToBeVisual: true });
  for (const key of ['window', 'document', 'navigator', 'MutationObserver', 'HTMLElement', 'Element', 'Node', 'DOMRect', 'KeyboardEvent', 'getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame']) {
    Object.defineProperty(globalThis, key, { value: dom.window[key]?.bind && ['getComputedStyle', 'requestAnimationFrame', 'cancelAnimationFrame'].includes(key) ? dom.window[key].bind(dom.window) : dom.window[key], configurable: true });
  }
  dom.window.Range.prototype.getClientRects = () => [];
  dom.window.Range.prototype.getBoundingClientRect = () => new dom.window.DOMRect();
  return dom;
}

export function actualVim(CodeMirror, referenceVim) {
  if (!process.env.OBSIDIAN_VIM_RUNTIME && process.env.OBSIDIAN_VIM_INSTALLED !== '1') return referenceVim;
  let source;
  if (process.env.OBSIDIAN_VIM_RUNTIME) source = fs.readFileSync(process.env.OBSIDIAN_VIM_RUNTIME, 'utf8');
  else {
    const root = path.join(os.homedir(), 'Library/Application Support/obsidian');
    const files = fs.readdirSync(root).filter(f => /^obsidian-.*\.asar$/.test(f)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    const bytes = fs.readFileSync(path.join(root, files.at(-1)));
    const header = JSON.parse(bytes.subarray(16, 16 + bytes.readUInt32LE(12)).toString());
    const entry = header.files.lib.files.codemirror.files['vim.js'];
    const offset = 8 + bytes.readUInt32LE(4) + Number(entry.offset);
    source = bytes.subarray(offset, offset + entry.size).toString();
  }
  // Use Obsidian's actual engine, not a simplified imitation of key dispatch.
  const body = source.replace(/CodeMirror\.Vim = initVimMode\(CodeMirror\);\s*$/, '\nreturn initVimMode;');
  const factory = vm.runInThisContext('(function () {\n' + body + '\n})()');
  return factory(CodeMirror);
}
