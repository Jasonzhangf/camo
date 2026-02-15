// Change Notifier - Subscribe to DOM changes and element events

export class ChangeNotifier {
  constructor() {
    this.subscriptions = new Map(); // topic -> Set<callback>
    this.elementWatchers = new Map(); // selector -> { lastState, callbacks }
    this.lastSnapshot = null;
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

    if (!this.elementWatchers.has(selector)) {
      this.elementWatchers.set(selector, {
        lastState: null,
        lastNotifyTime: 0,
        callbacks: { onAppear, onDisappear, onChange },
      });
    } else {
      const watcher = this.elementWatchers.get(selector);
      if (onAppear) watcher.callbacks.onAppear = onAppear;
      if (onDisappear) watcher.callbacks.onDisappear = onDisappear;
      if (onChange) watcher.callbacks.onChange = onChange;
    }

    return () => {
      this.elementWatchers.delete(selector);
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
    for (const [selector, watcher] of this.elementWatchers) {
      const { lastState, callbacks, lastNotifyTime, throttle } = watcher;

      // Throttle notifications
      if (now - lastNotifyTime < throttle) continue;

      const currentElements = this.findElements(snapshot, selector);
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
  findElements(node, selector, path = 'root') {
    const results = [];
    if (!node) return results;

    // Check if current node matches
    if (this.nodeMatchesSelector(node, selector)) {
      results.push({ ...node, path });
    }

    // Recurse into children
    if (node.children) {
      for (let i = 0; i < node.children.length; i++) {
        const childResults = this.findElements(node.children[i], selector, `${path}/${i}`);
        results.push(...childResults);
      }
    }

    return results;
  }

  // Check if node matches selector
  nodeMatchesSelector(node, selector) {
    if (!node) return false;

    // CSS selector match
    if (selector.css && node.selector === selector.css) return true;
    if (selector.css && node.classes) {
      const selClasses = selector.css.match(/\.[\w-]+/g);
      if (selClasses) {
        const nodeClasses = new Set(node.classes || []);
        if (selClasses.map(s => s.slice(1)).every(c => nodeClasses.has(c))) return true;
      }
    }

    // ID match
    if (selector.id && node.id === selector.id) return true;

    // Class match
    if (selector.classes) {
      const nodeClasses = new Set(node.classes || []);
      if (selector.classes.every(c => nodeClasses.has(c))) return true;
    }

    return false;
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
