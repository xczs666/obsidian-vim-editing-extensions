# Vim Editing Extensions

[中文说明](README.zh-CN.md)

Extend Obsidian's **built-in Vim mode** with automatic quote/surrounding text objects, sandwich-style editing, and register replacement. Works independently of Vimrc Support, and can coexist with an existing Vimrc configuration.

## Features

| Keys | Action | Example |
| --- | --- | --- |
| `iq` / `aq` | Inside / around any single, double or backtick quote pair | `viq`, `diq`, `ciq`, `yiq` |
| `ib` / `ab` | Inside / around automatically detected brackets, quotes or HTML/XML tags | `vib`, `vab`, `dib` |
| `sa{motion}{delimiter}` | Add surroundings | `saiw)` changes `hello` to `(hello)` |
| `sd{delimiter}` | Delete surroundings | `sd"` changes `"hello"` to `hello` |
| `sr{old}{new}` | Replace surroundings | `sr"'` changes `"hello"` to `'hello'` |
| `sdb` / `srb{new}` | Automatically find surroundings to delete / replace | `srb"` changes `(hello)` to `"hello"` |
| `sdt` / `sdT` | Remove matching tags and their attributes | `<span class="x">hello</span>` becomes `hello` |
| `saiwt` | Add tags: enter a name and attributes, then press Enter | `span class="x"` produces `<span class="x">hello</span>` |
| `gr{motion}` | Replace text with a Vim register, preserving copied text | `griw`, `griq`, `grib`, `gr$` |
| `[count]grr` | Replace whole lines with a register | `grr`, `2grr` |
| Visual selection + `gr` | Replace a characterwise or linewise selection | `viwgr`, `Vgr` |

Supports characterwise and linewise visual selections, nesting, counts, registers for text-object operators, single-step undo, redo, and native dot-repeat for surround and register replacement. `Esc` cancels pending input.

### Register replacement

Yank text with `yiw`, move to a target word, then type `griw`. Keep using `griw` or `.` to replace further targets without losing the copied text. Prefix a register name to choose a source, for example `"agriw` or `"0griw`; uppercase letters read the corresponding lowercase register. Dot-repeat reuses the source register name and reads its **current** contents. Counts enlarge the target range, not the inserted text; visual repeats reuse the selection's dimensions.

Characterwise replacement removes one trailing newline from a linewise register. Whole-line replacement keeps the boundary with following text and preserves whether the target document ends in a newline. Whole-line edits place the cursor at the first non-whitespace character of the first inserted line; other edits place it at the replacement start.

Only unnamed, letter and numbered Vim registers are supported. Clipboard (`+`/`*`), expression and other special registers, blockwise registers/selections and multiple cursors are unsupported. Empty registers and unsupported inputs produce a notice without editing text. Cancelled or failed replacements preserve the previous dot-repeat operation. No clipboard permissions or network access are requested.

Both bracket keys, such as `(` and `)`, produce the same pair without adding spaces. Surround edits preserve existing inner whitespace. New tag inputs `t` and `T` are equivalent in this plugin.

The `q` identifier is a **text object**, not an `sdq` surround alias. The `b` identifier finds all supported surroundings, not just parentheses. Use `v2ib` to select the second enclosing object's contents; use `2sd)` to remove the second enclosing parentheses, and `2saiw)` to add two layers.

## Install

Requires desktop Obsidian **1.14.5 or later** and built-in Vim key bindings enabled in **Settings → Editor**. Open the [Community directory listing](https://community.obsidian.md/plugins/vim-editing-extensions) or search **Vim Editing Extensions** in Community plugins. A new release may take time to appear in the desktop index. For manual installation:

1. Download `main.js` and `manifest.json` from the [latest GitHub release](https://github.com/xczs666/obsidian-vim-editing-extensions/releases/latest).
2. Create `<vault>/.obsidian/plugins/vim-editing-extensions/` and copy both files into it.
3. Reload installed plugins in **Settings → Community plugins**, then enable **Vim Editing Extensions**.

While enabled, `s` is reserved as a multi-key prefix; its usual single-key substitution action waits for another key. Disabling the plugin restores the original single-key mapping. Existing multi-key mappings such as `s"` from Vimrc Support can still be used; they are not installed by this plugin. The plugin does not modify your Vimrc.

## Matching and limitations

- Prefer the innermost structure containing the cursor; counts select outward. Without a containing structure, seek forward on the current line only.
- Brackets and complete tags may span lines; quote pairs are matched within one line and honor backslash escapes.
- Tags support attributes, quoted `>` characters and nested same-name elements. Self-closing/void tags cannot wrap content.
- Matching operates on Markdown **source text**, without a language parser or HTML execution. Angle brackets are also treated as literal delimiter pairs; explicitly select a tag with `t` when that distinction matters.
- Function/argument objects, arbitrary delimiter prompts, next/previous object search, blockwise selections, multiple cursors and macros are outside the first release's scope.
- Integration uses Obsidian's undocumented Vim adapter. Updates to Obsidian may require a plugin update. Missing required interfaces prevent registration and produce a diagnostic notice.

## Privacy

The plugin runs locally and makes **no network requests**. It has no accounts, telemetry, advertisements or remote services. Normal editing touches only the active editor.

The optional **Run compatibility checks (temporary note)** command creates a disposable note in the current vault, tests source/live-preview editors through the actual Vim dispatcher, writes `validation.json` in the plugin folder, then moves the disposable note to the vault trash. It restores the Vim registers used by the checks, does not reload your Vimrc and does not edit existing notes.

Development-only real-engine tests can read a locally installed Obsidian archive outside the vault when explicitly requested. These tests do not run when the plugin is loaded; Obsidian's engine is not bundled or redistributed.

## Development

Node.js 22 or later:

```sh
npm ci
npm test
npm run build
npm run prepare-release
```

Default tests use the open-source CodeMirror Vim reference engine and run in CI. To additionally test the engine shipped with your installed Obsidian on macOS:

```sh
npm run test:obsidian
```

Alternatively set `OBSIDIAN_VIM_RUNTIME` to a compatible `vim.js` file. Release assets are generated under `release/<version>/`; only `main.js` and `manifest.json` are required for installation. See [validation](VALIDATION.md).

## License and acknowledgments

[MIT](LICENSE). Behavior is inspired by [vim-sandwich](https://github.com/machakann/vim-sandwich), [mini.ai](https://github.com/nvim-mini/mini.ai), [targets.vim](https://github.com/wellle/targets.vim), and [ReplaceWithRegister](https://github.com/vim-scripts/ReplaceWithRegister). This is an independent implementation on top of Obsidian's built-in Vim engine, not a redistribution of those Vim plugins or Obsidian itself.
