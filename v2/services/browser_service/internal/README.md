# Browser Service Internals

Single truth owner for Camoufox (Firefox) browser lifecycle.

## Modules

| File | Purpose |
|------|---------|
| `camoufox_bridge.mjs` | Single owner for browser instances per profile |
| `engine-manager.mjs` | Camoufox context launch with display metrics |
| `fingerprint.mjs` | Stable fingerprint generation and application |
| `ProfileLock.mjs` | PID-based profile lock file |
| `storage-paths.mjs` | Data directory resolution |

## Engine Policy

- **Camoufox only** — Chromium removed
- All browser operations go through `camoufox_bridge.mjs`
- No direct `camoufox` imports elsewhere in v2

## Lifecycle

```
launchBrowser(pid, opts)
  -> ProfileLock.acquire()
  -> loadOrGenerateFingerprint(pid)
  -> launchEngineContext({ engine:'camoufox', ... })
  -> applyFingerprint(context, fingerprint)
  -> get/create page
  -> _records.set(pid, record)

closeBrowser(pid)
  -> context.close()
  -> ProfileLock.release()
  -> _records.delete(pid)
```
