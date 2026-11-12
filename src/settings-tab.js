import { PluginSettingTab, Setting, Notice } from 'obsidian';
import { GROUPS, OPTIONAL, OBJECTS, normalizeSettings, objectMappings } from './object-settings.js';

export class EditingSettingsTab extends PluginSettingTab {
  constructor(app, plugin) { super(app, plugin); this.plugin = plugin; }
  display() {
    const { containerEl: el, plugin } = this;
    el.empty();
    el.createEl('h2', { text: 'Vim Editing Extensions' });
    el.createEl('p', { text: 'Objects work in visual and operator-pending modes. Normal-mode I, A and L are unchanged. Disabling a mapping restores the underlying Vim mapping.' });
    const update = async next => {
      try { await plugin.updateSettings(next); } catch (error) { new Notice(error.message); this.display(); }
    };
    let timeoutInput;
    const timeoutRow = new Setting(el).setName('Prefix timeout (ms)').setDesc('Wait for s, visual I/A and next/previous object prefixes. 0 waits indefinitely. Timeout or no match uses the original shorter mapping.');
    timeoutRow.addText(input => {
      timeoutInput = input.inputEl;
      input.setValue(String(plugin.settings.prefixTimeoutMs));
      Object.assign(timeoutInput, { type: 'number', min: '0', max: '60000', step: '1', required: true });
      timeoutInput.setAttribute('aria-label', 'Prefix timeout in milliseconds');
    });
    const timeoutStatus = el.createEl('p', { attr: { role: 'status', 'aria-live': 'polite' } });
    timeoutStatus.id = 'vee-prefix-timeout-status';
    timeoutInput.setAttribute('aria-describedby', timeoutStatus.id);
    timeoutRow.addButton(button => button.setButtonText('Apply timeout').onClick(async () => {
      try {
        const value = timeoutInput.value.trim();
        const next = { ...plugin.settings, prefixTimeoutMs: value === '' ? NaN : Number(value) };
        objectMappings(next);
        await plugin.updateSettings(next);
        timeoutInput.removeAttribute('aria-invalid');
        timeoutStatus.setText('Prefix timeout saved.');
      } catch (error) {
        timeoutInput.setAttribute('aria-invalid', 'true');
        timeoutStatus.setText(error.message);
        timeoutInput.focus();
      }
    }));
    for (const [id, name] of Object.entries(GROUPS)) new Setting(el).setName(name).addToggle(toggle => toggle.setValue(plugin.settings.groups[id]).onChange(async value => {
      await update({ ...plugin.settings, groups: { ...plugin.settings.groups, [id]: value } });
    }));
    new Setting(el).setName('Next/previous objects').setDesc('in/an and il/al variants can search across lines.').addToggle(toggle => toggle.setValue(plugin.settings.navigation).onChange(value => update({ ...plugin.settings, navigation: value })));
    for (const [id, name] of Object.entries(OPTIONAL)) new Setting(el).setName(name).setDesc(id === 'whitespace' ? 'Visual I/A wait for an object identifier. Esc cancels; block insert remains native.' : 'Optional mapping; may replace an existing visual or operator-pending motion.').addToggle(toggle => toggle.setValue(plugin.settings[id]).onChange(value => update({ ...plugin.settings, [id]: value })));
    el.createEl('h3', { text: 'Object identifiers' });
    el.createEl('p', { text: 'Enter one character, <Space>, or leave empty to disable an object. Changes are applied together with Save bindings. Duplicate and reserved identifiers are rejected.' });
    const draft = normalizeSettings(plugin.settings);
    for (const object of OBJECTS) new Setting(el).setName(object.label).addText(input => {
      input.setValue(plugin.settings.bindings[object.id] ?? (object.trigger === ' ' ? '<Space>' : object.trigger));
      input.inputEl.setAttribute('aria-label', object.label + ' identifier');
      input.inputEl.spellcheck = false;
      input.inputEl.setAttribute('autocorrect', 'off');
      input.inputEl.setAttribute('autocapitalize', 'off');
      input.onChange(value => { draft.bindings[object.id] = value; });
    });
    const status = el.createEl('p', { attr: { role: 'status', 'aria-live': 'polite', tabindex: '-1' } });
    new Setting(el).addButton(button => button.setButtonText('Save bindings').setCta().onClick(async () => {
      try {
        const next = { ...plugin.settings, bindings: draft.bindings };
        objectMappings(next);
        await plugin.updateSettings(next);
        status.setText('Bindings saved.');
      } catch (error) { status.setText(error.message); status.focus(); }
    })).addButton(button => button.setButtonText('Reset bindings').onClick(async () => {
      await plugin.updateSettings({ ...plugin.settings, bindings: {} }); this.display();
    }));
  }
}
