# Validation

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

Mobile, blockwise selection editing, multiple cursors, macros, function/argument objects, arbitrary delimiter prompts and advanced next/previous object searching are outside this release. The tests do not claim complete equivalence to every feature of Vim plugins that inspired the key bindings.
