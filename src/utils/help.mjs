export function printHelp() {
  console.log(`
camo CLI - Camoufox browser controller

USAGE:
  camo <command> [options]

PROFILE MANAGEMENT:
  profiles                                  List profiles with default profile
  profile [list]                            List profiles (same as profiles)
  profile create <profileId>                Create a profile
  profile delete <profileId>                Delete a profile
  profile default [profileId]               Get or set default profile

INITIALIZATION:
  init                                      Ensure camoufox + browser-service
  init geoip                                Download GeoIP database
  init list                                 List available OS and region options
  create fingerprint --os <os> --region <r> Create browser fingerprint
  create profile <profileId>                Create a new profile

CONFIG:
  config repo-root [path]                   Get or set persisted webauto repo root

BROWSER CONTROL:
  init                                      Ensure camoufox + ensure browser-service daemon
  start [profileId] [--url <url>] [--headless]
  stop [profileId]
  status [profileId]
  list                                      Alias of status

NAVIGATION:
  goto [profileId] <url>                    Navigate to URL (uses default if profileId omitted)
  back [profileId]                          Navigate back (uses default)
  screenshot [profileId] [--output <file>] [--full]

INTERACTION:
  scroll [profileId] [--down|--up|--left|--right] [--amount <px>]
  click [profileId] <selector>              Click element by CSS selector
  type [profileId] <selector> <text>        Type text into element
  highlight [profileId] <selector>          Highlight element (red border, 2s)
  clear-highlight [profileId]               Clear all highlights
  viewport [profileId] --width <w> --height <h>

PAGES:
  new-page [profileId] [--url <url>]
  close-page [profileId] [index]
  switch-page [profileId] <index>
  list-pages [profileId]

SYSTEM:
  shutdown                                  Shutdown browser-service
  help

EXAMPLES:
  camo init
  camo init geoip
  camo init list
  camo create fingerprint --os mac --region us
  camo create fingerprint --os windows --region uk
  camo profile create myprofile
  camo profile default myprofile
  camo start --url https://example.com
  camo goto https://www.xiaohongshu.com
  camo scroll --down --amount 500
  camo click "#search-input"
  camo type "#search-input" "hello world"
  camo highlight ".post-card"
  camo viewport --width 1920 --height 1080
  camo stop

ENV:
  WEBAUTO_BROWSER_URL                       Default: http://127.0.0.1:7704
  WEBAUTO_REPO_ROOT                         Optional explicit webauto repo root
`);
}

export function printProfilesAndHint(listProfiles, getDefaultProfile) {
  const profiles = listProfiles();
  const defaultProfile = getDefaultProfile();
  console.log(JSON.stringify({ ok: true, profiles, defaultProfile, count: profiles.length }, null, 2));
  console.log('\\nRun `camo help` for usage.');
}
