# Browser Service Internals

Single truth owner for Camoufox (Firefox) browser lifecycle.

## Modules

| File | Purpose |
|------|---------|
| `camoufox_bridge.mjs` | Single owner for browser instances per profile |
| `engine-manager.mjs` | Camoufox context launch with display metrics |
| `fingerprint.mjs` | Stable fingerprint generation and application |
| `storage-paths.mjs` | Compatibility projection of profile-owned paths |

## Engine Policy

- **Camoufox only** — Chromium removed
- All browser operations go through `camoufox_bridge.mjs`
- No direct `camoufox` imports elsewhere in v2

## Lifecycle

```
launchBrowser(pid, opts)
  -> loadOrGenerateFingerprint(pid)
  -> launchEngineContext({ engine:'camoufox', ... })
  -> applyFingerprint(context, fingerprint)
  -> get/create page
  -> _records.set(pid, record)

closeBrowser(pid)
  -> context.close()
  -> _records.delete(pid)
```

Profile ownership is acquired and released only by
`v2/services/lock/manager.mjs`, orchestrated by browser-service bootstrap.
