Tags: camo, url, scheme, about:blank, bugfix

# Camo URL Scheme Fix (2026-03-09)

## Issue
`camo start --url about:blank` failed with:
```
Error: page.goto: Protocol error (Page.navigate): Invalid url: "https://about:blank"
```

## Root Cause
Two `ensureUrlScheme` functions (in `src/core/utils.mjs` and `src/utils/args.mjs`) were prepending `https://` to all non-http URLs, including special browser URLs like `about:blank`, `chrome://`, `file://`, etc.

## Fix
Added checks to both `ensureUrlScheme` functions to skip scheme prepending for special browser URLs:

1. `src/core/utils.mjs`:
```javascript
if (url.startsWith('about:') || url.startsWith('chrome:') || url.startsWith('file:')) {
  return url;
}
```

2. `src/utils/args.mjs`:
```javascript
if (/^(about|chrome|file|data|blob|javascript):/i.test(trimmed)) return trimmed;
```

## Verification
1. `camo start xhs-qa-1 --url about:blank` now works correctly
2. Tab stress test: 100 switch-page iterations, 100% success rate
3. Scroll stress test: 100 scroll iterations, 100% success rate
4. 2-tab detail test: 10 iterations of switch+scroll on 2 pages, 100% success rate

## Files Changed
- `src/core/utils.mjs`: Added special URL check
- `src/utils/args.mjs`: Added regex check for browser protocols
