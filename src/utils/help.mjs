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

LIFECYCLE & CLEANUP:
  sessions                                  List active browser sessions
  cleanup [profileId]                       Cleanup session (release lock + stop)
  cleanup all                               Cleanup all active sessions
  cleanup locks                             Cleanup stale lock files
  force-stop [profileId]                    Force stop session (for stuck sessions)
  lock list                                 List active session locks
  lock [profileId]                          Show lock info for profile
  unlock [profileId]                        Release lock for profile

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

COOKIES:
  cookies get [profileId]                          Get all cookies for profile
  cookies save [profileId] --path <file>           Save cookies to file
  cookies load [profileId] --path <file>           Load cookies from file
  cookies auto start [profileId] [--interval <ms>] Start auto-saving cookies
  cookies auto stop [profileId]                    Stop auto-saving
  cookies auto status [profileId]                  Check auto-save status

WINDOW:
  window move [profileId] --x <x> --y <y>          Move browser window
  window resize [profileId] --width <w> --height <h> Resize browser window

MOUSE:
  mouse move [profileId] --x <x> --y <y> [--steps <n>]  Move mouse to coordinates
  mouse click [profileId] --x <x> --y <y> [--button left|right|middle] [--clicks <n>] [--delay <ms>]  Click at coordinates
  mouse wheel [profileId] [--deltax <px>] [--deltay <px>]  Scroll wheel

SYSTEM:
  system display                                   Show display metrics

SYSTEM:
  shutdown                                  Shutdown browser-service (stops all sessions)
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
  camo cookies get
  camo cookies save --path /tmp/cookies.json
  camo cookies load --path /tmp/cookies.json
  camo cookies auto start --interval 5000
  camo window move --x 100 --y 100
  camo window resize --width 1920 --height 1080
  camo mouse move --x 500 --y 300
  camo mouse click --x 500 --y 300 --button left
  camo mouse wheel --deltay -300
  camo system display
  camo sessions
  camo cleanup myprofile
  camo force-stop myprofile
  camo lock list
  camo unlock myprofile
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
  console.log('\\nRun \`camo help\` for usage.');
}
