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

### Markdown tables (0.4.0)

`viT` selects the complete current pipe table; `yiT`, or `y` after `viT`, yanks its Markdown header, delimiter row and all body rows as linewise text. It works from a header or body cell in live preview as well as from source mode. The uppercase `T` preserves native lowercase `it/at` tag objects and `ip/ap` paragraph objects. `aT` also includes one adjacent blank line when available. Named/append/black-hole registers retain native yank behavior, for example `"ayiT` or `viT"ay`.

Live-preview table selection uses a dedicated whole-table highlight and a document range independent of nested cell selections. Use Vim `y` to copy this selection; system clipboard behavior follows the host's existing Vim configuration. Esc, another key, a pointer interaction, leaving the editor, a document change, settings changes or unloading cancel the selection. This first version supports selection and yank of one table; editing operators and counts are rejected. Ordinary pipe tables are supported; HTML tables and tables nested in block quotes/indented code are excluded.

The **Markdown table selection and yank** group and the **Markdown table** identifier control this feature. If an existing custom object already uses `T`, the new table identifier starts disabled to preserve that binding.

### Extended objects (0.3.0)

| Objects | Meaning |
| --- | --- |
| `iX/aX`, where X is space or `_ , - . ; : + = ~ * / \\ \| & $` | Literal separator segments, including first/last segments on a line |
| `iL/aL` | Current line without/with indentation and trailing spaces, excluding the final newline |
| `iS/aS` | Subword: snake_case, kebab-case, camelCase, acronyms and digits |
| `iD/aD` | Inside/around `[[double brackets]]`; an embed's leading `!` is excluded |
| `io/ao` | Automatic `()`, `[]`, `{}` only; `ib/ab` retain their wider matching |
| `ii/iI`, `ai/aI`, `ig/ag` | Inner indentation, indentation plus upper/upper-and-lower border, and greedy indentation |
| `ik/ak`, `iv/av` | A single-line key/value in structured regions or ordinary source text |
| `ia/aa` | Arguments, ignoring commas in nested containers and escaped strings |
| `if/af` | Contents of a function call / callable name plus parentheses |
| `i?/a?` | Prompt for literal left/right boundaries, including multi-character boundaries |
| `inX/anX`, `ilX/alX` | Next/previous object, explicitly searching across lines |

For example, in `foo_bar`, `vi_` selects `foo` or `bar`; `va_` includes the right separator, falling back to the left at the end. Repeated separator characters form one boundary. A line must contain the requested separator; no match leaves the document and previous repeat unchanged. `i,` is a literal comma segment, **not** an argument; use `ia`. No `#` object is registered.

Counts combine adjacent segments/subwords/lines, or select enclosing nested objects. Repeating an object in visual mode grows the selection and stops at its boundary. `v2inq` selects the second next quote. Existing native direct bracket/quote/tag objects remain native; the extension adds their next/previous forms.

Key/value objects accept `label: value` and `key=value`, including ordinary prose labels. `ik/iv` exclude surrounding whitespace but keep the token's own quotes; `ak` includes the assignment separator, `av` includes a trailing comma/semicolon. Bare URLs, times and comparison expressions are excluded. Multiline values and multiple fields on one line are unsupported. Known fenced-code/frontmatter comments are excluded; ordinary prose `#tags` are retained.

Arguments/calls use lexical bracket and quote matching, not a language grammar. Function definitions, language-specific generics, regular expressions and template interpolation are outside this feature's guarantees. Indentation uses the editor tab width and does not cross frontmatter/fence boundaries. Blank lines delimit zero-indent blocks.

### Settings and optional mappings

The settings tab provides independent object groups and editable identifiers. Empty identifiers disable an object; duplicate/reserved identifiers are rejected when **Save bindings** is pressed. Identifiers such as `_` can be remapped without editing the Vimrc. Changes cancel pending prompts and replace only the plugin's own mappings.

Three optional groups default to **off**: URL object `L`, whitespace variants `IX/AX`, and entire-document object `gG`. Enable them in settings if wanted. `I` trims inner whitespace; `A` includes both boundaries and adjacent horizontal whitespace. When enabled, visual `I/A` wait for an object identifier; `Esc` cancels. Normal-mode `I/A/L` and native block insert stay unchanged. URL `L` and `gG` work only in visual/operator-pending contexts.

Custom boundary prompts never interpret regular expressions or execute source. `.` reuses the accepted boundaries without prompting; cancellation, a document change or a leaf switch invalidates pending input. Local `data.json` is ignored and never included in release assets.

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

### Prefix timeout

Set **Prefix timeout (ms)** in this plugin's settings and click **Apply timeout**. `100` waits up to 100 ms for the next key; `0` (the default) waits indefinitely. This applies only to prefixes deferred by this plugin: `s`, optional visual `I/A`, and `n/l` after an object prefix. It does not change every Vim mapping or Obsidian hotkey.

A timely match continues the combination. For example, once `sd` or `sa` matches, the remaining target or motion has no timer. On timeout, the original shorter mapping runs once. On a mismatch, that shorter mapping runs and the remaining key is offered to the host, then to its normal Vim dispatcher if unhandled. Native `s` therefore substitutes a character and enters insert mode; a custom single-key mapping runs its configured action. The plugin has no dependency on the action's provider. DOM key handoff uses a synthetic event, so handlers requiring trusted browser events cannot be guaranteed.

`Esc`, focus/leaf changes, pointer interaction, IME composition, changed document/selection, settings changes and unloading cancel a pending prefix without executing it. Existing multi-key mappings such as `s"` from Vimrc Support still work. Disabling restores the original single-key mapping; this plugin does not modify your Vimrc.

## Matching and limitations

- Prefer the innermost structure containing the cursor; counts select outward. Without a containing structure, seek forward on the current line only.
- Brackets and complete tags may span lines; quote pairs are matched within one line and honor backslash escapes.
- Tags support attributes, quoted `>` characters and nested same-name elements. Self-closing/void tags cannot wrap content.
- Matching operates on Markdown **source text**, without a language parser or HTML execution. Angle brackets are also treated as literal delimiter pairs; explicitly select a tag with `t` when that distinction matters.
- Blockwise selection editing, multiple cursors, macros, language-grammar text objects, folds, viewport objects and diagnostics are outside this release. Existing native block insertion is preserved.
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
