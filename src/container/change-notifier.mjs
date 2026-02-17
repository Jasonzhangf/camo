// Change Notifier - Subscribe to DOM changes and element events

function normalizeSelector(selector) {
  if (!selector) return { visible: true };
  if (typeof selector === 'string') return { css: selector, visible: true };
  if (typeof selector !== 'object') return { visible: true };
  return {
    ...selector,
    visible: selector.visible !== false,
  };
}

function selectorKey(selector) {
  const normalized = normalizeSelector(selector);
  const stable = {
    css: normalized.css || null,
    tag: normalized.tag || null,
    id: normalized.id || null,
    classes: Array.isArray(normalized.classes) ? [...normalized.classes].sort() : [],
    visible: normalized.visible !== false,
  };
  return JSON.stringify(stable);
}

function parseCssSelector(css) {
  const raw = typeof css === 'string' ? css.trim() : '';
  if (!raw) return [];
  const attrRegex = /\[\s*([^\s~|^$*=\]]+)\s*(\*=|\^=|\$=|=)?\s*(?:"([^"]*)"|'([^']*)'|([^\]\s]+))?\s*\]/g;
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const tagMatch = item.match(/^[a-zA-Z][\w-]*/);
      const idMatch = item.match(/#([\w-]+)/);
      const classMatches = item.match(/\.([\w-]+)/g) || [];
      const attrs = [];
      let attrMatch = attrRegex.exec(item);
      while (attrMatch) {
        attrs.push({
          name: String(attrMatch[1] || '').toLowerCase(),
          op: attrMatch[2] || 'exists',
          value: attrMatch[3] ?? attrMatch[4] ?? attrMatch[5] ?? '',
        });
        attrMatch = attrRegex.exec(item);
      }
      attrRegex.lastIndex = 0;
      return {
        tag: tagMatch ? tagMatch[0].toLowerCase() : null,
        id: idMatch ? idMatch[1] : null,
        classes: classMatches.map((token) => token.slice(1)),
        attrs,
      };
    });
}

function nodeAttribute(node, name, nodeId, nodeClasses) {
  const key = String(name || '').toLowerCase();
  if (!key) return null;
  if (key === 'id') return nodeId || null;
  if (key === 'class') return Array.from(nodeClasses).join(' ');

  const attrs = node?.attrs && typeof node.attrs === 'object' ? node.attrs : null;
  if (attrs && attrs[key] !== undefined && attrs[key] !== null) return String(attrs[key]);

  const direct = node?.[key];
  if (typeof direct === 'string' || typeof direct === 'number' || typeof direct === 'boolean') {
    return String(direct);
  }
  return null;
}

function matchAttribute(node, attrSpec, nodeId, nodeClasses) {
  const value = nodeAttribute(node, attrSpec.name, nodeId, nodeClasses);
  if (attrSpec.op === 'exists') return value !== null && value !== '';
  if (value === null) return false;
  const expected = String(attrSpec.value || '');
  if (attrSpec.op === '=') return value === expected;
  if (attrSpec.op === '*=') return value.includes(expected);
  if (attrSpec.op === '^=') return value.startsWith(expected);
  if (attrSpec.op === '$=') return value.endsWith(expected);
  return false;
}

export class ChangeNotifier {
  constructor() {
    this.subscriptions = new Map(); // topic -> Set<callback>
    this.elementWatchers = new Map(); // selector -> { lastState, callbacks }
    this.lastSnapshot = null;
  }

  nodePassesVisibility(node, selector, viewport) {
    const normalized = normalizeSelector(selector);
    if (normalized.visible === false) return true;
    if (!node || typeof node !== 'object') return false;
    if (typeof node.visible === 'boolean') return node.visible;

    const rect = node.rect || null;
    if (!rect) return true;
    const width = Number(rect.width || 0);
    const height = Number(rect.height || 0);
    if (width <= 0 || height <= 0) return false;

    const vw = Number(viewport?.width || 0);
    const vh = Number(viewport?.height || 0);
    if (vw <= 0 || vh <= 0) return true;
    const left = Number(rect.left ?? rect.x ?? 0);
    const top = Number(rect.top ?? rect.y ?? 0);
    const right = Number(rect.right ?? (left + width));
    const bottom = Number(rect.bottom ?? (top + height));
    return right > 0 && bottom > 0 && left < vw && top < vh;
  }

  // Subscribe to a topic
  subscribe(topic, callback) {
    if (!this.subscriptions.has(topic)) {
      this.subscriptions.set(topic, new Set());
    }
    this.subscriptions.get(topic).add(callback);
    return () => {
      this.subscriptions.get(topic)?.delete(callback);
    };
  }

  // Watch specific elements by selector
  watch(selector, options = {}) {
    const { onAppear, onDisappear, onChange, throttle = 200 } = options;
    const resolvedSelector = normalizeSelector(selector);
    const key = selectorKey(resolvedSelector);
    const resolvedThrottle = Math.max(50, Number(throttle) || 200);

    if (!this.elementWatchers.has(key)) {
      this.elementWatchers.set(key, {
        selector: resolvedSelector,
        lastState: null,
        lastNotifyTime: 0,
        throttle: resolvedThrottle,
        callbacks: { onAppear, onDisappear, onChange },
      });
    } else {
      const watcher = this.elementWatchers.get(key);
      if (onAppear) watcher.callbacks.onAppear = onAppear;
      if (onDisappear) watcher.callbacks.onDisappear = onDisappear;
      if (onChange) watcher.callbacks.onChange = onChange;
      watcher.throttle = resolvedThrottle;
    }

    return () => {
      this.elementWatchers.delete(key);
    };
  }

  // Notify all subscribers of a topic
  notify(topic, data) {
    const callbacks = this.subscriptions.get(topic);
    if (!callbacks) return;
    for (const callback of callbacks) {
      try {
        callback(data);
      } catch (err) {
        console.error(`[ChangeNotifier] callback error for ${topic}:`, err);
      }
    }
  }

  // Process new DOM snapshot and trigger notifications
  processSnapshot(snapshot) {
    const now = Date.now();
    const prevSnapshot = this.lastSnapshot;
    this.lastSnapshot = snapshot;

    // Notify general DOM change
    this.notify('dom:changed', { snapshot, prevSnapshot });

    // Process element watchers
    for (const [, watcher] of this.elementWatchers) {
      const { lastState, callbacks, lastNotifyTime, throttle } = watcher;

      // Throttle notifications
      if (now - lastNotifyTime < throttle) continue;

      const currentElements = this.findElements(snapshot, watcher.selector);
      const currentState = currentElements.map(e => e.path).sort().join(',');

      if (lastState !== null && currentState !== lastState) {
        // Something changed
        const prevElements = watcher.prevElements || [];
        const appeared = currentElements.filter(e => !prevElements.find(p => p.path === e.path));
        const disappeared = prevElements.filter(e => !currentElements.find(c => c.path === e.path));

        if (appeared.length > 0 && callbacks.onAppear) {
          callbacks.onAppear(appeared);
          watcher.lastNotifyTime = now;
        }
        if (disappeared.length > 0 && callbacks.onDisappear) {
          callbacks.onDisappear(disappeared);
          watcher.lastNotifyTime = now;
        }
        if (callbacks.onChange) {
          callbacks.onChange({ current: currentElements, previous: prevElements, appeared, disappeared });
          watcher.lastNotifyTime = now;
        }
      }

      watcher.lastState = currentState;
      watcher.prevElements = currentElements;
    }
  }

  // Find elements matching selector in DOM tree
  findElements(node, selector, path = 'root', context = null) {
    const results = [];
    if (!node) return results;
    const normalized = normalizeSelector(selector);
    const runtimeContext = context || {
      viewport: node?.__viewport || null,
    };

    // Check if current node matches
    if (this.nodeMatchesSelector(node, normalized) && this.nodePassesVisibility(node, normalized, runtimeContext.viewport)) {
      results.push({ ...node, path });
    }

    // Recurse into children
    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        const childResults = this.findElements(node.children[i], normalized, `${path}/${i}`, runtimeContext);
        results.push(...childResults);
      }
    }

    return results;
  }

  // Check if node matches selector
  nodeMatchesSelector(node, selector) {
    if (!node) return false;
    const normalized = normalizeSelector(selector);
    if (!normalized || typeof normalized !== 'object') return false;

    const nodeTag = typeof node.tag === 'string' ? node.tag.toLowerCase() : null;
    const nodeId = typeof node.id === 'string' ? node.id : null;
    const nodeClasses = new Set(Array.isArray(node.classes) ? node.classes : []);

    // Exact selector string (fast path).
    if (normalized.css && node.selector === normalized.css) return true;

    const cssVariants = parseCssSelector(normalized.css);
    if (cssVariants.length > 0) {
      for (const cssVariant of cssVariants) {
        const hasConstraints = Boolean(
          cssVariant.tag
            || cssVariant.id
            || (cssVariant.classes && cssVariant.classes.length > 0)
            || (cssVariant.attrs && cssVariant.attrs.length > 0),
        );
        if (!hasConstraints) continue;

        let matched = true;
        if (cssVariant.tag && nodeTag !== cssVariant.tag) matched = false;
        if (cssVariant.id && nodeId !== cssVariant.id) matched = false;
        if (matched && cssVariant.classes.length > 0) {
          matched = cssVariant.classes.every((className) => nodeClasses.has(className));
        }
        if (matched && cssVariant.attrs.length > 0) {
          matched = cssVariant.attrs.every((attrSpec) => matchAttribute(node, attrSpec, nodeId, nodeClasses));
        }
        if (matched) return true;
      }
    }

    const requiredTag = normalized.tag ? String(normalized.tag).toLowerCase() : null;
    const requiredId = normalized.id ? String(normalized.id) : null;
    const requiredClasses = Array.isArray(normalized.classes)
      ? normalized.classes.filter(Boolean).map((className) => String(className))
      : [];

    const hasStructuredSelector = Boolean(requiredTag || requiredId || requiredClasses.length > 0);
    if (!hasStructuredSelector) return false;
    if (requiredTag && nodeTag !== requiredTag) return false;
    if (requiredId && nodeId !== requiredId) return false;
    if (requiredClasses.length > 0 && !requiredClasses.every((className) => nodeClasses.has(className))) {
      return false;
    }
    return true;
  }

  // Cleanup
  destroy() {
    this.subscriptions.clear();
    this.elementWatchers.clear();
    this.lastSnapshot = null;
  }
}

// Global instance
let globalNotifier = null;

export function getChangeNotifier() {
  if (!globalNotifier) {
    globalNotifier = new ChangeNotifier();
  }
  return globalNotifier;
}

export function destroyChangeNotifier() {
  if (globalNotifier) {
    globalNotifier.destroy();
    globalNotifier = null;
  }
}
