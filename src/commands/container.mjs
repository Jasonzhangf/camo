// Container commands - filter, watch, and subscription targets
import { getDomSnapshotByProfile, getSessionByProfile, getViewportByProfile } from '../utils/browser-service.mjs';
import { getDefaultProfile } from '../utils/config.mjs';
import { getChangeNotifier } from '../container/change-notifier.mjs';
import { createElementFilter } from '../container/element-filter.mjs';
import {
  getRegisteredTargets,
  initContainerSubscriptionDirectory,
  listSubscriptionSets,
  registerSubscriptionTargets,
} from '../container/subscription-registry.mjs';
import { safeAppendProgressEvent } from '../events/progress-log.mjs';

const notifier = getChangeNotifier();
const elementFilter = createElementFilter();

const VALUE_FLAGS = new Set([
  '--profile',
  '-p',
  '--selector',
  '-s',
  '--throttle',
  '-t',
  '--source',
  '--site',
]);

function readFlagValue(args, names) {
  for (let i = 0; i < args.length; i += 1) {
    if (!names.includes(args[i])) continue;
    const value = args[i + 1];
    if (!value || String(value).startsWith('-')) return null;
    return value;
  }
  return null;
}

function collectPositionals(args, startIndex = 2) {
  const out = [];
  for (let i = startIndex; i < args.length; i += 1) {
    const arg = args[i];
    if (!arg) continue;
    if (VALUE_FLAGS.has(arg)) {
      i += 1;
      continue;
    }
    if (String(arg).startsWith('-')) continue;
    out.push(arg);
  }
  return out;
}

async function ensureSession(profileId) {
  const session = await getSessionByProfile(profileId);
  if (!session) {
    throw new Error(`No active session for profile: ${profileId || 'default'}`);
  }
  return session;
}

function resolveWatchProfileAndSelectors(args) {
  const explicitProfile = readFlagValue(args, ['--profile', '-p']);
  const explicitSelector = readFlagValue(args, ['--selector', '-s']);
  const positionals = collectPositionals(args);

  if (explicitSelector) {
    const profileId = explicitProfile || positionals[0] || getDefaultProfile();
    return { profileId, selectors: [explicitSelector], source: 'manual' };
  }

  if (explicitProfile) {
    return {
      profileId: explicitProfile,
      selectors: positionals,
      source: positionals.length > 0 ? 'manual' : 'subscription',
    };
  }

  if (positionals.length >= 2) {
    return { profileId: positionals[0], selectors: positionals.slice(1), source: 'manual' };
  }

  if (positionals.length === 1) {
    const candidateProfile = getRegisteredTargets(positionals[0])?.profile;
    if (candidateProfile) {
      return { profileId: positionals[0], selectors: [], source: 'subscription' };
    }
    return { profileId: getDefaultProfile(), selectors: [positionals[0]], source: 'manual' };
  }

  return { profileId: getDefaultProfile(), selectors: [], source: 'subscription' };
}

function resolveProfileAndSelectors(args) {
  const explicitProfile = readFlagValue(args, ['--profile', '-p']);
  const positionals = collectPositionals(args);
  if (explicitProfile) {
    return { profileId: explicitProfile, selectors: positionals };
  }
  if (positionals.length >= 2) {
    return { profileId: positionals[0], selectors: positionals.slice(1) };
  }
  return { profileId: getDefaultProfile(), selectors: positionals };
}

function resolveListProfile(args) {
  const explicitProfile = readFlagValue(args, ['--profile', '-p']);
  if (explicitProfile) return explicitProfile;
  const positionals = collectPositionals(args);
  return positionals[0] || getDefaultProfile();
}

export async function handleContainerInitCommand(args) {
  const source = readFlagValue(args, ['--source']);
  const force = args.includes('--force');
  const result = initContainerSubscriptionDirectory({
    ...(source ? { containerLibraryRoot: source } : {}),
    force,
  });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleContainerSetsCommand(args) {
  const site = readFlagValue(args, ['--site']);
  const result = listSubscriptionSets({ ...(site ? { site } : {}) });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleContainerRegisterCommand(args) {
  const explicitProfile = readFlagValue(args, ['--profile', '-p']);
  const append = args.includes('--append');
  const positionals = collectPositionals(args);

  let profileId;
  let setIds;
  if (explicitProfile) {
    profileId = explicitProfile;
    setIds = positionals;
  } else if (positionals.length >= 2) {
    profileId = positionals[0];
    setIds = positionals.slice(1);
  } else {
    profileId = getDefaultProfile();
    setIds = positionals;
  }

  if (!profileId) {
    throw new Error('Usage: camo container register [profileId] <setId...> [--append] [--profile <id>]');
  }
  if (!Array.isArray(setIds) || setIds.length === 0) {
    throw new Error('Usage: camo container register [profileId] <setId...> [--append] [--profile <id>]');
  }

  const result = registerSubscriptionTargets(profileId, setIds, { append });
  console.log(JSON.stringify(result, null, 2));
}

export async function handleContainerTargetsCommand(args) {
  const explicitProfile = readFlagValue(args, ['--profile', '-p']);
  const positionals = collectPositionals(args);
  const profileId = explicitProfile || positionals[0] || null;
  const result = getRegisteredTargets(profileId);
  console.log(JSON.stringify(result, null, 2));
}

export async function handleContainerFilterCommand(args) {
  const { profileId, selectors } = resolveProfileAndSelectors(args);
  if (!profileId) {
    throw new Error('Usage: camo container filter [profileId] <selector...> [--profile <id>]');
  }
  if (selectors.length === 0) {
    throw new Error('Usage: camo container filter [profileId] <selector...> [--profile <id>]');
  }

  const session = await ensureSession(profileId);
  const snapshot = await getDomSnapshotByProfile(session.profileId || profileId);

  const matched = [];
  for (const selector of selectors) {
    const elements = notifier.findElements(snapshot, { css: selector });
    matched.push(
      ...elements.map((element) => ({
        selector,
        path: element.path,
        tag: element.tag,
        id: element.id,
        classes: element.classes,
        text: (element.textSnippet || element.text || '').slice(0, 80),
      })),
    );
  }

  console.log(JSON.stringify({ ok: true, profileId: session.profileId || profileId, count: matched.length, elements: matched }, null, 2));
}

export async function handleContainerWatchCommand(args) {
  const watchRequest = resolveWatchProfileAndSelectors(args);
  const profileId = watchRequest.profileId;
  if (!profileId) {
    throw new Error(
      'Usage: camo container watch [profileId] [--selector <css>|<selector...>] [--throttle ms] [--profile <id>]',
    );
  }

  let selectors = Array.from(
    new Set(
      (watchRequest.selectors || [])
        .map((item) => String(item || '').trim())
        .filter(Boolean),
    ),
  );
  let source = watchRequest.source;

  if (selectors.length === 0) {
    const registered = getRegisteredTargets(profileId)?.profile;
    selectors = Array.from(
      new Set(
        (registered?.selectors || [])
          .map((item) => item?.css)
          .filter((css) => typeof css === 'string' && css.trim())
          .map((css) => css.trim()),
      ),
    );
    source = 'subscription';
  }

  if (selectors.length === 0) {
    throw new Error(
      `No selectors found for profile: ${profileId}. Use --selector <css> or run camo container register ${profileId} <setId...> first.`,
    );
  }

  const session = await ensureSession(profileId);
  const throttleRaw = readFlagValue(args, ['--throttle', '-t']);
  const throttle = Math.max(100, Number(throttleRaw) || 500);

  console.log(JSON.stringify({
    ok: true,
    message: `Watching ${selectors.length} selector(s) from ${source}`,
    selectors,
    profileId: session.profileId || profileId,
    throttle,
  }));
  safeAppendProgressEvent({
    source: 'container.watch',
    mode: 'normal',
    profileId: session.profileId || profileId,
    event: 'container.watch.start',
    payload: {
      selectors,
      throttle,
      source,
    },
  });

  const interval = setInterval(async () => {
    try {
      const snapshot = await getDomSnapshotByProfile(session.profileId || profileId);
      notifier.processSnapshot(snapshot);
    } catch (err) {
      console.error(JSON.stringify({ ok: false, error: err?.message || String(err) }));
    }
  }, throttle);

  const watchers = selectors.map((selector) => notifier.watch({ css: selector }, {
    onAppear: (elements) => {
      console.log(JSON.stringify({ event: 'appear', selector, count: elements.length, elements }));
      safeAppendProgressEvent({
        source: 'container.watch',
        mode: 'normal',
        profileId: session.profileId || profileId,
        event: 'container.appear',
        payload: { selector, count: elements.length },
      });
    },
    onDisappear: (elements) => {
      console.log(JSON.stringify({ event: 'disappear', selector, count: elements.length }));
      safeAppendProgressEvent({
        source: 'container.watch',
        mode: 'normal',
        profileId: session.profileId || profileId,
        event: 'container.disappear',
        payload: { selector, count: elements.length },
      });
    },
    onChange: ({ appeared, disappeared }) => {
      console.log(JSON.stringify({ event: 'change', selector, appeared: appeared.length, disappeared: disappeared.length }));
      safeAppendProgressEvent({
        source: 'container.watch',
        mode: 'normal',
        profileId: session.profileId || profileId,
        event: 'container.change',
        payload: { selector, appeared: appeared.length, disappeared: disappeared.length },
      });
    },
    throttle,
  }));

  process.once('SIGINT', () => {
    clearInterval(interval);
    for (const stopWatch of watchers) stopWatch();
    notifier.destroy();
    console.log(JSON.stringify({ ok: true, message: 'Watch stopped' }));
    safeAppendProgressEvent({
      source: 'container.watch',
      mode: 'normal',
      profileId: session.profileId || profileId,
      event: 'container.watch.stop',
      payload: { selectors },
    });
    process.exit(0);
  });
}

export async function handleContainerListCommand(args) {
  const profileId = resolveListProfile(args);
  if (!profileId) {
    throw new Error('Usage: camo container list [profileId] [--profile <id>]');
  }
  const session = await ensureSession(profileId);

  const snapshot = await getDomSnapshotByProfile(session.profileId || profileId);
  const viewport = await getViewportByProfile(session.profileId || profileId);

  const collectElements = (node, domPath = 'root') => {
    const elements = [];
    if (!node) return elements;

    const rect = node.rect || node.bbox;
    if (rect && viewport) {
      const inViewport = elementFilter.isInViewport(rect, viewport);
      const visibilityRatio = elementFilter.getVisibilityRatio(rect, viewport);
      if (inViewport && visibilityRatio > 0.1) {
        elements.push({
          path: domPath,
          tag: node.tag,
          id: node.id,
          classes: node.classes?.slice(0, 3),
          visibilityRatio: Math.round(visibilityRatio * 100) / 100,
          rect: { x: rect.left || rect.x, y: rect.top || rect.y, w: rect.width, h: rect.height },
        });
      }
    }

    if (Array.isArray(node.children)) {
      for (let i = 0; i < node.children.length; i += 1) {
        elements.push(...collectElements(node.children[i], `${domPath}/${i}`));
      }
    }

    return elements;
  };

  const elements = collectElements(snapshot);
  console.log(JSON.stringify({
    ok: true,
    profileId: session.profileId || profileId,
    viewport,
    count: elements.length,
    elements: elements.slice(0, 50),
  }, null, 2));
}

export async function handleContainerCommand(args) {
  const sub = args[1];

  switch (sub) {
    case 'init':
      return handleContainerInitCommand(args);
    case 'sets':
      return handleContainerSetsCommand(args);
    case 'register':
      return handleContainerRegisterCommand(args);
    case 'targets':
      return handleContainerTargetsCommand(args);
    case 'filter':
      return handleContainerFilterCommand(args);
    case 'watch':
      return handleContainerWatchCommand(args);
    case 'list':
      return handleContainerListCommand(args);
    default:
      console.log(`Usage: camo container <init|sets|register|targets|filter|watch|list> [options]

Commands:
  init [--source <container-library-dir>] [--force]         Initialize subscription directory and migrate container sets
  sets [--site <siteKey>]                                    List migrated subscription sets
  register [profileId] <setId...> [--append]                Register subscription targets for profile
  targets [profileId]                                        Show registered targets
  filter [profileId] <selector...>                           Filter DOM elements by CSS selector
  watch [profileId] [--selector <css>] [--throttle <ms>]     Watch for element changes (defaults to registered selectors)
  list [profileId]                                           List visible elements in viewport

Options:
  --profile, -p <id>                                         Profile to use
  --selector, -s <css>                                       Selector for watch
  --throttle, -t <ms>                                        Poll interval for watch (default: 500)
  --site <siteKey>                                           Filter set list by site
`);
  }
}
