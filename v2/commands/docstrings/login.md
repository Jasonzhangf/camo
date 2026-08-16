# `camo login`

Open a persistent browser session on the requested profile, navigate to the
login URL in foreground mode, and wait for the user to complete the login
flow. Cookie state is auto-saved by Camoufox to the configured profile
directory; the login survives across restarts.

## Usage

```bash
camo login --profile default \
           --url https://example.com/sign-in \
           --until-url example.com/account \
           --timeout 300000
```

## Flags

| Flag                 | Required | Default   | Notes                                                |
|----------------------|----------|-----------|------------------------------------------------------|
| `--profile`          | no       | `default` | profile id; persistent (default keeps cookies)      |
| `--url`              | **yes**  |           | login URL (must start with `http(s)://`)            |
| `--until-url`        | one of   |           | URL substring that signals completion                |
| `--until-cookie-name`| one of   |           | cookie name that signals completion (recommended)   |
| `--timeout`          | no       | `300000`  | max wait ms (min 1000)                              |

## Semantics

- Opens the browser in **foreground** (non-headless) so you can see and
  interact with the page.
- Polls URL + cookies every 1.5 s. As soon as either `--until-url`
  substring matches OR the named cookie changes,
  the command returns success.
- Cookies written by Camoufox during navigation are persisted in the
  configured profile directory. There is no separate save step.
- The browser stays open after `login` returns. Run
  `camo stop --profile <id>` to close it. Re-running `camo login` on the same
  profile resumes the existing session; existing cookies remain valid.

## Exit codes

- success: `{cmd:"login", profile, matched:true, lastUrl, savedCookiesAt}`
- timeout: `E_LOGIN_TIMEOUT` (browser stays open)

## Example

```bash
# 1. ensure daemon is up
camo daemon start --profile default

# 2. open the login flow
camo login --profile default \
           --url https://example.com/sign-in \
           --until-url example.com/account

# 3. open another authenticated page in the same profile
camo new-tab --profile default --url https://example.com/settings

# 4. when done, stop the browser
camo stop --profile default
```
