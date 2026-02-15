// Container commands - filter and watch elements
import { resolveProfileId, getPositionals } from '../utils/args.mjs';
import { callAPI, getSessionByProfile } from '../utils/browser-service.mjs';
import { getDefaultProfile } from '../utils/config.mjs';
import { getChangeNotifier } from '../container/change-notifier.mjs';
import { createElementFilter } from '../container/element-filter.mjs';

const notifier = getChangeNotifier();
const elementFilter = createElementFilter();

export async function handleContainerFilterCommand(args) {
  const profileId = resolveProfileId(args, 1, getDefaultProfile);
  const session = await getSessionByProfile(profileId);
  if (!session) {
    throw new Error(`No active session for profile: ${profileId || 'default'}`);
  }

  const selectors = [];
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--profile' || arg === '-p') { i++; continue; }
    if (arg.startsWith('--')) continue;
    selectors.push(arg);
  }

  if (selectors.length === 0) {
    throw new Error('Usage: camo container filter <selector> [--profile <id>]');
  }

  // Get DOM snapshot from browser service
  const result = await callAPI(`/session/${session.session_id}/dom-tree`, { method: 'POST' });
  const snapshot = result.dom_tree || result;

  // Filter elements
  const matched = [];
  for (const selector of selectors) {
    const elements = notifier.findElements(snapshot, { css: selector });
    matched.push(...elements.map(e => ({
      path: e.path,
      tag: e.tag,
      id: e.id,
      classes: e.classes,
      text: (e.textSnippet || e.text || '').slice(0, 50),
    })));
  }

  console.log(JSON.stringify({ ok: true, count: matched.length, elements: matched }, null, 2));
}

export async function handleContainerWatchCommand(args) {
  const profileId = resolveProfileId(args, 1, getDefaultProfile);
  const session = await getSessionByProfile(profileId);
  if (!session) {
    throw new Error(`No active session for profile: ${profileId || 'default'}`);
  }

  const positionalArgs = getPositionals(args, ['--profile', '-p', '--selector', '-s', '--throttle', '-t']);
  
  const selectorIdx = args.indexOf('--selector') !== -1 ? args.indexOf('--selector') : args.indexOf('-s');
  const throttleIdx = args.indexOf('--throttle') !== -1 ? args.indexOf('--throttle') : args.indexOf('-t');
  
  const selector = selectorIdx >= 0 ? args[selectorIdx + 1] : positionalArgs[0];
  const throttle = throttleIdx >= 0 ? parseInt(args[throttleIdx + 1], 10) : 500;

  if (!selector) {
    throw new Error('Usage: camo container watch --selector <css> [--throttle ms] [--profile <id>]');
  }

  console.log(JSON.stringify({ ok: true, message: `Watching selector: ${selector}`, throttle }));

  // Setup WebSocket connection for DOM updates
  // For now, poll the browser service
  const interval = setInterval(async () => {
    try {
      const result = await callAPI(`/session/${session.session_id}/dom-tree`, { method: 'POST' });
      const snapshot = result.dom_tree || result;
      notifier.processSnapshot(snapshot);
    } catch (err) {
      console.error(JSON.stringify({ ok: false, error: err.message }));
    }
  }, throttle);

  // Watch the selector
  notifier.watch({ css: selector }, {
    onAppear: (elements) => {
      console.log(JSON.stringify({ event: 'appear', selector, count: elements.length, elements }));
    },
    onDisappear: (elements) => {
      console.log(JSON.stringify({ event: 'disappear', selector, count: elements.length }));
    },
    onChange: ({ appeared, disappeared }) => {
      console.log(JSON.stringify({ event: 'change', selector, appeared: appeared.length, disappeared: disappeared.length }));
    },
    throttle,
  });

  // Keep process alive
  process.on('SIGINT', () => {
    clearInterval(interval);
    notifier.destroy();
    console.log(JSON.stringify({ ok: true, message: 'Watch stopped' }));
    process.exit(0);
  });
}

export async function handleContainerListCommand(args) {
  const profileId = resolveProfileId(args, 1, getDefaultProfile);
  const session = await getSessionByProfile(profileId);
  if (!session) {
    throw new Error(`No active session for profile: ${profileId || 'default'}`);
  }

  const result = await callAPI(`/session/${session.session_id}/dom-tree`, { method: 'POST' });
  const snapshot = result.dom_tree || result;

  // Get viewport info
  const viewportResult = await callAPI(`/session/${session.session_id}/viewport`);
  const viewport = viewportResult.viewport || { width: 1280, height: 720 };

  // Collect all visible elements
  const collectElements = (node, path = 'root') => {
    const elements = [];
    if (!node) return elements;

    const rect = node.rect || node.bbox;
    if (rect && viewport) {
      const inViewport = elementFilter.isInViewport(rect, viewport);
      const visibilityRatio = elementFilter.getVisibilityRatio(rect, viewport);

      if (inViewport && visibilityRatio > 0.1) {
        elements.push({
          path,
          tag: node.tag,
          id: node.id,
          classes: node.classes?.slice(0, 3),
          visibilityRatio: Math.round(visibilityRatio * 100) / 100,
          rect: { x: rect.left || rect.x, y: rect.top || rect.y, w: rect.width, h: rect.height },
        });
      }
    }

    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        elements.push(...collectElements(node.children[i], `${path}/${i}`));
      }
    }

    return elements;
  };

  const elements = collectElements(snapshot);
  console.log(JSON.stringify({ ok: true, viewport, count: elements.length, elements: elements.slice(0, 50) }, null, 2));
}

export async function handleContainerCommand(args) {
  const sub = args[1];

  switch (sub) {
    case 'filter':
      return handleContainerFilterCommand(args.slice(1));
    case 'watch':
      return handleContainerWatchCommand(args.slice(1));
    case 'list':
      return handleContainerListCommand(args.slice(1));
    default:
      console.log(`Usage: camo container <filter|watch|list> [options]

Commands:
  filter <selector>  - Filter DOM elements by CSS selector
  watch --selector <css> - Watch for element changes (outputs JSON events)
  list               - List all visible elements in viewport

Options:
  --profile, -p <id>  - Profile to use
  --throttle, -t <ms> - Throttle interval for watch (default: 500)
`);
  }
}
