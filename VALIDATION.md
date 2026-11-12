# Validation

## Public release 0.4.0

Validation date: 2026-11-12. This version was installed and validated locally before publication.

| Check | Result |
| --- | --- |
| Portable reference-engine, resolver and table-range tests | 66 / 66 passed |
| Obsidian 1.15.0 bundled-engine integration tests | 44 / 44 passed |
| Obsidian 1.14.5 bundled-engine integration tests | 44 / 44 passed |
| Running Obsidian 1.15.0 source/live-preview compatibility checks | 178 / 178 passed |
| Physical live-preview header viT highlight and delayed y | Passed; register and clipboard contain complete Markdown |
| Physical live-preview body-cell yiT | Passed; register and clipboard contain complete Markdown |
| Physical Esc cancellation | Passed; whole-table highlight removed |

The regression covers a table selection surviving the loss/replacement of a nested cell's native visual selection before the copy key. Physical checks used rendered header/body cell editors with real key events and time between selection and yank. The app stayed in live preview. Source and live-preview command checks also exercise a delayed copy. The temporary notes were saved and moved to vault trash; register, macro and clipboard state used by the checks was restored. Local reports contain generated fixtures only.

Table parsing checks cover optional outer pipes, escaped pipes, alignment markers, exact source preservation, CRLF/EOF, missing body cells, frontmatter, fenced/indented code and following block boundaries. Runtime checks include linewise/default/named/append/black-hole registers, native lowercase tag/paragraph mapping preservation, remapping, cancellation, stale documents, counts and unsupported editing rejection. This version supports one ordinary Markdown pipe table for selection and yank; HTML tables, block-quote tables, table editing and counts are outside this addition.

## Public release 0.3.0

Validation date: 2026-11-12. This version was installed and validated locally before publication.

| Check | Result |
| --- | --- |
| Portable reference-engine and pure resolver tests (`npm test`) | 58 / 58 passed |
| Obsidian 1.15.0 actual bundled-engine integration tests (`npm run test:obsidian`) | 40 / 40 passed |
| Obsidian 1.14.5 installed base-engine integration tests | 40 / 40 passed |
| Running Obsidian 1.15.0 source editor | 87 / 87 passed |
| Running Obsidian 1.15.0 live-preview editor | 87 / 87 passed |
| Settings tab rejects duplicate identifiers and restores defaults | Passed in app |
| Timeout settings reject invalid values and persist 100 ms | Passed in app |
| Physical single-key timeout in source/live preview and timely surround edit | Passed in app |
| Physical unmatched-key handoff to a host listener and insert-mode fallback | Passed in app |
| Build and local installation asset comparison | Passed |
| Source credential scan (Gitleaks) | No findings |
| Private-domain, personal-path, email and accidental-note checks | No findings in source/build snapshot |

The 174 in-app checks used a disposable note, all object groups, default identifiers, navigation, and the optional URL/whitespace/document mappings enabled. No object group was skipped. The command restored its registers and original active leaf, flushed the temporary note before moving it to the vault trash, and the note was confirmed absent from the vault root. Reports contain generated test fixtures only and remain ignored local artifacts.

The new tests cover first/last/consecutive separators, the separate meanings of `i_`, `i,` and `ia`, counts and visual expansion, subwords, double brackets and bracket-only matching, indentation with blank lines/tabs/frontmatter/fence boundaries, ordinary and structured key/value lines, nested arguments and lexical function calls, cross-line next/previous selection, custom literal prompts with cancellation and concrete dot-repeat, optional mappings, remapping and group disable/re-enable. Existing surround, register replacement, history and register-preservation tests remain included.

The plugin's general defaults leave the three optional mappings off; this local installation explicitly enables them. The test bridge uses locally extracted engines only; neither those engines nor personal settings are redistributed.

Prefix tests cover the exact 99/100 ms boundary, a delayed timer, accepted combinations retaining unlimited time for their remaining motion/target, shorter native/custom mappings, counts and named registers, foreign s-prefixed mappings, cancellation, zero/unlimited waiting, and internal mappings avoiding unrelated physical-event replay. The in-app physical check exposed and fixed premature microtask cleanup between native event listeners. A before-deadline physical mismatch check used 5000 ms to accommodate native automation delays; deterministic engine tests verify the 100 ms boundary. Final local settings use 100 ms. The remaining-key host handoff uses a synthetic event; trusted-event-only handlers are outside the compatibility claim.

## Public release 0.2.0

Validation date: 2026-11-10.

| Check | Result |
| --- | --- |
| Portable reference-engine tests (`npm test`) | 31 / 31 passed |
| Obsidian 1.15.0 actual bundled-engine integration tests (`npm run test:obsidian`) | 21 / 21 passed |
| Obsidian 1.14.5 installed base-engine integration tests | 21 / 21 passed |
| Running Obsidian 1.15.0 source editor | 48 / 48 passed |
| Running Obsidian 1.15.0 live-preview editor | 48 / 48 passed |
| Build and release asset generation | Passed |

Register replacement checks cover native motions and text objects, counts, unnamed/named/numbered sources, copied-text preservation, line endings, EOF, Unicode, visual replacement and replay, native undo/redo, cancellation, unsupported inputs, and disable/re-enable behavior. Layout-independent explicit line motions are used in jsdom; the in-app linewise checks use the real editor layout.

The in-app run used the built 0.2.0 plugin, an automatically created temporary note and the actual Vim adapter in both editing modes. The report contained 96 passing checks. The note was saved, moved to the vault trash and confirmed absent from the vault root; the check restores the Vim registers it uses. No existing note was used as a test buffer. Extracted engines and local validation reports are ignored and are not redistributed.

## Public release 0.1.1

Validation date: 2026-11-09.

| Check | Result |
| --- | --- |
| Portable reference-engine tests (`npm test`) | 22 / 22 passed |
| Obsidian 1.15.0 actual bundled-engine integration tests (`npm run test:obsidian`) | 13 / 13 passed |
| Obsidian 1.14.5 actual bundled-engine integration tests (`OBSIDIAN_VIM_RUNTIME=... npm run test:runtime`) | 13 / 13 passed |
| Standalone operation with the default single-key `s` mapping | Passed |
| Existing custom single-key `s` mapping restored after disable | Passed |
| Build and release asset generation | Passed |
| Source credential scan (Gitleaks) | No findings |
| Private-domain, personal-path, email and accidental-note checks | No findings in publication files |
| Dependency archive hosts | Public npm registry only |

Tests use actual CM6 documents/history, fixed expected text, selection/register assertions and native Vim dispatch. For real Obsidian-engine tests, the development bridge supplies two adapter position/selection helpers that Obsidian adds to the upstream adapter. The Vim engine itself is read from the local installation and is never committed or redistributed.

## Prior in-app prototype validation

Before publication hardening, the 0.1.0 prototype passed 58 / 58 checks in a running Obsidian 1.15.0 instance, covering source and live-preview editors, legacy Vimrc shortcuts, native undo/redo and dot-repeat. Those checks ran through the actual editor adapter and dispatcher, not the development bridge. This is prototype provenance, not a claim that the modified 0.1.1 release received the same separate in-app run.

The temporary check note was saved, moved to the vault trash and confirmed absent from the vault root. No existing note was used as a test buffer.

## Boundaries

Mobile, blockwise selection editing, multiple cursors, macros, full language-grammar objects, folds, viewport objects and diagnostics are outside the current build. Native block insertion is preserved. Key/value objects are single-line; arguments and calls use lexical matching rather than a language parser. The tests do not claim complete equivalence to every feature of Vim plugins that inspired the key bindings.
