# Publication privacy review

The public repository is assembled from an explicit allowlist of plugin source, tests, build configuration and documentation. No vault notes, vault configuration, vault Git history, authentication files, dependency directories, or extracted Obsidian runtime files are included.

Before publication:

- Recreate the dependency lockfile from the public npm registry, removing private registry references from the local prototype.
- Check source files, generated JavaScript, release assets and the Git snapshot for credentials, internal links, personal paths and accidental note content.
- Use the maintainer's personal GitHub identity and GitHub noreply address for commits. Do not inherit an unrelated global Git email.
- For 0.2.0 and later, attach only the plugin binary and manifest. Local checksums remain outside Git; the 0.1.1 historical attachments remain unchanged.

The runtime plugin does not access the network or use credentials. A clean scan reduces accidental disclosure risk; it is not a proof that every possible secret format has been detected.
