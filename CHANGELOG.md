# Changelog

## 0.3.0

- Add configurable prefix timeout (0 means unlimited), original-mapping fallback on timeout/mismatch, and generic remaining-key handoff without depending on another plugin.
- Add literal separator segments, line/subword/double-bracket objects, automatic bracket aliases, indentation, keys/values, arguments and function calls.
- Add counted next/previous object navigation and incremental visual selection.
- Add literal custom-boundary prompts with cancellation and repeat protection.
- Add object-group settings, configurable identifiers and opt-in URL, whitespace and whole-document mappings.
- Keep `_` for underscore segments, `,` for literal comma segments, `a` for arguments and `L` for line objects after i/a.
- Retain native surround/register behavior, named-register copying and ordinary/block insert mappings.

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
