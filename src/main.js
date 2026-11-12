import { Plugin, Notice } from 'obsidian';
import { Transaction } from '@codemirror/state';
import { isolateHistory } from '@codemirror/commands';
import { installVimExtensions } from './vim.js';
import { runSmoke } from './smoke.js';
import { normalizeSettings, objectMappings } from './object-settings.js';
import { EditingSettingsTab } from './settings-tab.js';
import { isForwardedKey } from './prefixes.js';

export default class VimEditingExtensions extends Plugin {
  async onload() {
    this.controllers = new Map();
    this.disposed = false;
    this.reported = false;
    this.keyEvents = new WeakMap();
    this.settings = normalizeSettings(await this.loadData());
    try { objectMappings(this.settings); } catch (error) {
      this.settings = normalizeSettings();
      new Notice(`Vim Editing Extensions: invalid saved settings; using defaults. ${error.message}`);
    }
    this.addSettingTab(new EditingSettingsTab(this.app, this));
    this.app.workspace.onLayoutReady(() => this.install());
    this.registerEvent(this.app.workspace.on('active-leaf-change', () => {
      for (const controller of this.controllers.values()) controller.cancelAll();
      this.install();
    }));
    this.registerEvent(this.app.workspace.on('window-open', () => this.install()));
    this.addCommand({
      id: 'run-compatibility-checks',
      name: 'Run compatibility checks (temporary note)',
      callback: async () => {
        if (this.testing) return;
        this.testing = true;
        try {
          const report = await runSmoke(this);
          await this.app.vault.adapter.write(this.manifest.dir + '/validation.json', JSON.stringify(report, null, 2) + '\n');
          new Notice(`Vim Editing Extensions: ${report.passed}/${report.results.length} compatibility checks passed.`);
        } catch (error) {
          console.error('[vim-editing-extensions] Compatibility check failed:', error);
          new Notice('Vim Editing Extensions: compatibility check failed. See developer console.');
        } finally { this.testing = false; }
      },
    });
  }

  getCM(view) { return view?.editMode?.editor?.cm?.cm ?? view?.editor?.cm?.cm; }

  async updateSettings(settings) {
    const next = normalizeSettings(settings);
    objectMappings(next);
    const previous = this.settings;
    this.settings = next;
    this.settingsWrite = (this.settingsWrite ?? Promise.resolve()).catch(() => {}).then(() => this.saveData(this.settings));
    try { await this.settingsWrite; } catch (error) {
      if (this.settings === next) this.settings = previous;
      throw error;
    }
    if (this.disposed || this.settings !== next) return;
    for (const controller of this.controllers.values()) controller.uninstall();
    this.controllers.clear();
    this.install();
  }

  install() {
    if (this.disposed) return;
    const windows = new Set([this.app.workspace.containerEl.ownerDocument.defaultView]);
    this.app.workspace.iterateAllLeaves(leaf => windows.add(leaf.view.containerEl.ownerDocument.defaultView));
    for (const win of windows) {
      const V = win?.CodeMirrorAdapter?.Vim;
      if (!V || this.controllers.has(V)) continue;
      try {
        const controller = installVimExtensions(V, {
          settings: this.settings,
          notify: text => new Notice(text),
          isCurrent: cm => this.getCM(this.app.workspace.activeLeaf?.view) === cm,
          getEvent: () => this.keyEvents.get(win),
          prompt: (cm, request) => this.prompt(cm, request),
          applyEdit: (cm, edit) => this.applyEdit(cm, edit),
        });
        this.controllers.set(V, controller);
        // Cleanup incomplete motions after physical key dispatch, not internal events.
        this.keyWindows ??= new WeakSet();
        if (!this.keyWindows.has(win)) {
          const cancel = () => this.controllers.get(V)?.cancelPrefixes();
          this.registerDomEvent(win, 'keydown', event => {
            if (isForwardedKey(event)) return;
            if (event.isComposing || event.keyCode === 229) { cancel(); return; }
            this.keyEvents.set(win, event);
            const cm = this.getCM(this.app.workspace.activeLeaf?.view);
            // Native event dispatch can run microtasks between capture and
            // target listeners. Keep the event until the entire dispatch ends.
            win.setTimeout(() => {
              if (this.keyEvents.get(win) === event) this.keyEvents.delete(win);
              if (cm && !event.target?.closest?.('[data-vim-editing-prompt]')) {
                this.controllers.get(V)?.finishInput(cm, event.key === 'Escape' ? '<Esc>' : event.key);
              }
            }, 0);
          }, true);
          this.registerDomEvent(win, 'blur', cancel);
          this.registerDomEvent(win.document, 'pointerdown', cancel, true);
          this.registerDomEvent(win.document, 'compositionstart', cancel, true);
          this.registerDomEvent(win.document, 'focusin', cancel, true);
        }
        this.keyWindows.add(win);
      } catch (error) {
        console.error('[vim-editing-extensions] Unsupported Vim runtime:', error);
        if (!this.reported) {
          new Notice('Vim Editing Extensions: this Vim runtime is not supported; no extension mappings were installed.');
          this.reported = true;
        }
      }
    }
  }

  applyEdit(cm, edit) {
    if (!cm.cm6?.dispatch) throw new Error('Unsupported editor: CM6 transaction API is unavailable');
    cm.operation(() => {
      cm.curOp.isVimOp = true;
      cm.cm6.dispatch({
        changes: { from: edit.from, to: edit.to, insert: edit.insert },
        selection: { anchor: edit.cursor },
        annotations: [Transaction.userEvent.of('input.vim-surround'), isolateHistory.of('full')],
      });
    });
  }

  prompt(cm, request) {
    const doc = cm.getWrapperElement().ownerDocument;
    const label = doc.createElement('label');
    label.dataset.vimEditingPrompt = '';
    label.append(doc.createTextNode(request.label + ': '));
    const input = doc.createElement('input');
    input.type = 'text';
    input.setAttribute('aria-label', request.label);
    input.setAttribute('spellcheck', 'false');
    input.autocapitalize = 'off';
    label.append(input);
    let done = false;
    let close;
    const finish = (value, cancelled = false) => {
      if (done) return;
      done = true;
      close?.();
      if (cancelled) request.cancel(); else request.accept(value);
    };
    close = cm.openDialog(label, value => finish(value), {
      bottom: true, selectValueOnOpen: false,
      onClose: () => { if (!done) finish('', true); },
      onKeyDown: event => {
        // Do not submit a tag while Enter is confirming an IME composition.
        if (event.isComposing || event.keyCode === 229) return true;
        if (event.key === 'Escape' || (event.ctrlKey && ['c', '['].includes(event.key))) {
          event.preventDefault(); event.stopPropagation(); finish('', true); return true;
        }
        if (request.single && event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) {
          event.preventDefault(); event.stopPropagation(); finish(event.key); return true;
        }
        if (!request.single && event.key === 'Enter') {
          event.preventDefault(); event.stopPropagation(); finish(input.value); return true;
        }
        return false;
      },
    });
    return () => { done = true; close?.(); };
  }

  onunload() {
    this.disposed = true;
    for (const controller of this.controllers.values()) controller.uninstall();
    this.controllers.clear();
  }
}
