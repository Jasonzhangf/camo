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
  highlight-mode [status|on|off]            Global highlight mode for click/type/scroll (default: on)

BROWSER CONTROL:
  init                                      Ensure camoufox + ensure browser-service daemon
  start [profileId] [--url <url>] [--headless] [--devtools] [--record] [--record-name <name>] [--record-output <path>] [--record-overlay|--no-record-overlay] [--alias <name>] [--idle-timeout <duration>] [--width <w> --height <h>]
  stop [profileId]
  stop --id <instanceId>                    Stop by instance id
  stop --alias <alias>                      Stop by alias
  stop idle                                 Stop all idle sessions
  stop all                                  Stop all sessions
  status [profileId]
  list                                      Alias of status

LIFECYCLE & CLEANUP:
  instances                                 List global camoufox instances (live + registered + idle state)
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
  scroll [profileId] [--down|--up|--left|--right] [--amount <px>] [--selector <css>] [--highlight|--no-highlight]
  click [profileId] <selector> [--highlight|--no-highlight]  Click visible element by CSS selector
  type [profileId] <selector> <text> [--highlight|--no-highlight]  Type into visible input element
  highlight [profileId] <selector>          Highlight element (red border, 2s)
  clear-highlight [profileId]               Clear all highlights
  viewport [profileId] --width <w> --height <h>

PAGES:
  new-page [profileId] [--url <url>]
  close-page [profileId] [index]
  switch-page [profileId] <index>
  list-pages [profileId]

DEVTOOLS:
  devtools logs [profileId] [--limit 120] [--since <unix_ms>] [--levels error,warn] [--clear]
  devtools eval [profileId] <expression> [--profile <id>]
  devtools clear [profileId]

RECORDING:
  record start [profileId] [--name <name>] [--output <file>] [--overlay|--no-overlay]
  record stop [profileId] [--reason <text>]
  record status [profileId]

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
  camo start --url https://example.com --alias main
  camo start worker-1 --headless --alias shard1 --idle-timeout 45m
  camo start worker-1 --devtools
  camo start worker-1 --record --record-name xhs-debug --record-output ./logs/xhs-debug.jsonl --record-overlay
  camo start myprofile --width 1920 --height 1020
  camo highlight-mode on
  camo devtools eval myprofile "document.title"
  camo devtools logs myprofile --levels error,warn --limit 50
  camo record start myprofile --name session-a --output ./logs/session-a.jsonl
  camo record status myprofile
  camo record stop myprofile
  camo stop --id inst_xxxxxxxx
  camo stop --alias shard1
  camo stop idle
  camo close all
  camo goto https://www.xiaohongshu.com
  camo scroll --down --amount 500 --selector ".feed-list"
  camo click "#search-input" --highlight
  camo type "#search-input" "hello world" --highlight
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
  camo instances
  camo cleanup myprofile
  camo force-stop myprofile
  camo lock list
  camo unlock myprofile
  camo stop

CONTAINER FILTER & SUBSCRIPTION:
  container init [--source <dir>] [--force]         Initialize subscription dir + migrate container sets
  container sets [--site <siteKey>]                 List migrated subscription sets
  container register [profileId] <setId...>         Register targets (path / url+dom markers) for profile
  container targets [profileId]                     Show registered subscription targets
  container filter [profileId] <selector...>        Filter DOM elements by CSS selector
  container watch [profileId] [--selector <css>]    Watch for element changes (or use registered selectors)
  container list [profileId]                        List visible elements in viewport

AUTOSCRIPT (STRATEGY LAYER):
  autoscript validate <file>                        Validate autoscript schema and references
  autoscript explain <file>                         Print normalized graph and defaults
  autoscript snapshot <jsonl-file> [--out <snapshot-file>] Build resumable snapshot from run JSONL
  autoscript replay <jsonl-file> [--summary-file <path>]   Rebuild summary from run JSONL
  autoscript run <file> [--profile <id>] [--jsonl-file <path>] [--summary-file <path>]  Run autoscript runtime
  autoscript resume <file> --snapshot <snapshot-file> [--from-node <nodeId>] [--profile <id>] [--jsonl-file <path>] [--summary-file <path>]
  autoscript mock-run <file> --fixture <fixture.json> [--profile <id>] [--jsonl-file <path>] [--summary-file <path>]

PROGRESS EVENTS:
  events serve [--host 127.0.0.1] [--port 7788]    Start progress websocket server (/events)
  events tail [filters...]                          Tail progress events via websocket
  events recent [--limit 50]                        Show recent persisted events
  events emit --event <name>                        Emit a manual test event
  (non-events commands auto-start daemon by default)

ENV:
  WEBAUTO_BROWSER_URL                       Default: http://127.0.0.1:7704
  WEBAUTO_INSTALL_DIR                       Optional @web-auto/webauto install dir
  WEBAUTO_REPO_ROOT                         Optional webauto repo root (dev mode)
  WEBAUTO_DATA_ROOT / WEBAUTO_HOME         Optional data root (Windows default D:\\webauto)
  WEBAUTO_PROFILE_ROOT                      Optional profile dir override
  WEBAUTO_ROOT                              Legacy data root (auto-appends .webauto if needed)
  CAMO_PROGRESS_EVENTS_FILE                 Optional path override for progress jsonl
  CAMO_PROGRESS_WS_HOST / CAMO_PROGRESS_WS_PORT   Progress daemon host/port (defaults: 127.0.0.1:7788)
`);
}

export function printProfilesAndHint(listProfiles, getDefaultProfile) {
  const profiles = listProfiles();
  const defaultProfile = getDefaultProfile();
  console.log(JSON.stringify({ ok: true, profiles, defaultProfile, count: profiles.length }, null, 2));
  console.log('\\nRun \`camo help\` for usage.');
}
