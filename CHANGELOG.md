# Changelog

## 0.2.0

- Add `gr{motion}`, `grr`, counted replacements and characterwise/linewise visual replacement.
- Read unnamed, named and numbered Vim registers without overwriting copied text.
- Support single-step undo/redo and dot-repeat using the current source register contents.
- Preserve the previous repeat and selection on cancellation or failure; reject empty, clipboard, special and blockwise registers safely.
- Extend in-app compatibility checks and restore the registers used by the checks.
- Publish only the required JavaScript and manifest release assets.

## 0.1.1

First public release.

- Add automatic quote (`iq/aq`) and surrounding (`ib/ab`) text objects.
- Add sandwich-style surround operations, tag prompts, nesting, counts, undo/redo and dot-repeat.
- Work independently of a personal Vimrc and preserve existing mappings on disable.
- Add public npm dependency sources, portable tests and CI.
- Keep all runtime editing local and include an optional in-app compatibility check.

## 0.1.0

Initial local prototype, tested in source and live-preview editors before publication.
