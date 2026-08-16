# camo multi-open

Open multiple URLs serially in deterministic tab order, then capture a
screenshot of each tab.

## Usage

```bash
camo multi-open --urls "https://a.com,https://b.com,https://c.com" [--out-dir <dir>] [--prefix <name>] [--profile <id>]
```

## Arguments

- `--urls` (required): comma-separated list of absolute http(s) URLs.
- `--out-dir`: directory to save screenshots (default: none, screenshots kept in memory only).
- `--prefix`: screenshot filename prefix (default: `multi-open`).
- `--profile`: profile id (default: `$CAMO_PROFILE` or `default`).

## Output

```json
{
  "cmd": "multi-open",
  "opened": [{"tabId": 0, "url": "https://a.com"}],
  "screenshots": [{"tabId": 0, "url": "https://a.com", "size": 12345, "path": null}],
  "errors": []
}
```

All tabs remain open only after every navigation and screenshot succeeds. On
failure, tabs created by this command are closed and the command returns an
`E_BROWSER_MULTIOPEN_FAILED` error.
