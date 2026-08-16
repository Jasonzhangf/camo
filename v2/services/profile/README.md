# services-profile

Single owner for profile metadata, profile storage paths, and profile-scoped
cookie backup files. See `v2/resources/registry/modules.json` for the
canonical module id.

## Public owners

- `store.mjs`: `camo-profile.json` read/write/delete.
- `storage_paths.mjs`: configured profile root, profile-owned paths, and the
  one-time fail-fast migration from legacy per-profile fingerprint/cookie paths.
- `cookie_store.mjs`: Netscape cookie backups under
  `<profile-dir>/cookie-backups/`.
