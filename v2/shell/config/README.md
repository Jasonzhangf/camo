# shell/config

Daemon discovery and config loading.

- `loader.mjs` — config file + env + CLI overrides
- `daemon_finder.mjs` — compatibility read facade over the canonical `services.daemon_registration` owner; it never scans or mutates registration files
