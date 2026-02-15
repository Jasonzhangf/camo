// Camo Container Client - High-level API for container subscription

import { callAPI, getSessionByProfile, checkBrowserService } from '../utils/browser-service.mjs';
import { getDefaultProfile } from '../utils/config.mjs';
import { getChangeNotifier } from '../container/change-notifier.mjs';
import { createElementFilter } from '../container/element-filter.mjs';

export class CamoContainerClient {
  constructor(options = {}) {
    this.profileId = options.profileId || getDefaultProfile();
    this.serviceUrl = options.serviceUrl || 'http://127.0.0.1:7704';
    this.notifier = getChangeNotifier();
    this.filter = createElementFilter(options.filterOptions || {});
    this.session = null;
    this.pollInterval = null;
    this.subscriptions = new Map(); // containerId -> callback
    this.lastSnapshot = null;
    this.viewport = { width: 1280, height: 720 };
  }

  async ensureSession() {
    if (this.session) return this.session;
    
    if (!await checkBrowserService()) {
      throw new Error('Browser service not running. Run: camo init');
    }

    this.session = await getSessionByProfile(this.profileId);
    if (!this.session) {
      throw new Error(`No active session for profile: ${this.profileId}`);
    }

    return this.session;
  }

  async getSnapshot() {
    await this.ensureSession();

    const result = await callAPI(`/session/${this.session.session_id}/dom-tree`, { method: 'POST' });
    this.lastSnapshot = result.dom_tree || result;
    return this.lastSnapshot;
  }

  async getViewport() {
    await this.ensureSession();

    try {
      const result = await callAPI(`/session/${this.session.session_id}/viewport`);
      this.viewport = result.viewport || this.viewport;
    } catch {}

    return this.viewport;
  }

  // Subscribe to container changes
  async subscribe(containers, options = {}) {
    const { throttle = 500 } = options;
    await this.ensureSession();

    for (const container of containers) {
      const { containerId, selector, onAppear, onDisappear, onChange } = container;

      this.notifier.watch(
        typeof selector === 'string' ? { css: selector } : selector,
        {
          onAppear: (elements) => {
            this.subscriptions.get(containerId)?.onAppear?.(elements);
          },
          onDisappear: (elements) => {
            this.subscriptions.get(containerId)?.onDisappear?.(elements);
          },
          onChange: (data) => {
            this.subscriptions.get(containerId)?.onChange?.(data);
          },
          throttle,
        }
      );

      this.subscriptions.set(containerId, {
        selector,
        onAppear,
        onDisappear,
        onChange,
      });
    }

    // Start polling
    if (!this.pollInterval) {
      this.pollInterval = setInterval(async () => {
        try {
          const snapshot = await this.getSnapshot();
          this.notifier.processSnapshot(snapshot);
        } catch (err) {
          // Ignore errors during polling
        }
      }, throttle);
    }

    return {
      unsubscribe: () => {
        for (const container of containers) {
          this.subscriptions.delete(container.containerId);
        }
      },
    };
  }

  // Checkpoint detection helper
  async detectCheckpoint(checkpointRules) {
    const snapshot = await this.getSnapshot();
    const viewport = await this.getViewport();

    const matched = new Set();

    for (const [checkpointId, rule] of Object.entries(checkpointRules)) {
      const { selectors, requireAll = false } = rule;
      let matchCount = 0;

      for (const selector of selectors) {
        const elements = this.notifier.findElements(snapshot, { css: selector });
        const visible = elements.filter(e => {
          const rect = e.rect || e.bbox;
          if (!rect) return false;
          return this.filter.isInViewport(rect, viewport);
        });

        if (visible.length > 0) {
          matchCount++;
        }
      }

      if (requireAll) {
        if (matchCount === selectors.length) {
          matched.add(checkpointId);
        }
      } else {
        if (matchCount > 0) {
          matched.add(checkpointId);
        }
      }
    }

    return Array.from(matched);
  }

  // List visible elements
  async listVisibleElements(options = {}) {
    const { minVisibility = 0.1, maxResults = 50 } = options;
    const snapshot = await this.getSnapshot();
    const viewport = await this.getViewport();

    const collect = (node, path = 'root') => {
      const elements = [];
      if (!node) return elements;

      const rect = node.rect || node.bbox;
      if (rect) {
        const ratio = this.filter.getVisibilityRatio(rect, viewport);
        if (ratio >= minVisibility) {
          elements.push({
            path,
            tag: node.tag,
            id: node.id,
            classes: node.classes?.slice(0, 3),
            visibilityRatio: Math.round(ratio * 100) / 100,
            rect: { x: rect.left || rect.x, y: rect.top || rect.y, w: rect.width, h: rect.height },
          });
        }
      }

      if (node.children) {
        for (let i = 0; i < node.children.length; i++) {
          elements.push(...collect(node.children[i], `${path}/${i}`));
        }
      }

      return elements;
    };

    const all = collect(snapshot);
    return all.slice(0, maxResults);
  }

  // Cleanup
  destroy() {
    if (this.pollInterval) {
      clearInterval(this.pollInterval);
      this.pollInterval = null;
    }
    this.subscriptions.clear();
    this.notifier.destroy();
  }
}

export function createCamoClient(options) {
  return new CamoContainerClient(options);
}
