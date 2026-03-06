/* eslint-disable no-var */
// __DOM_PICKER_INLINE_START
/* DOM picker runtime: window.__domPicker
 * Responsible for pointer -> DOM -> highlight -> selection.
 */
(() => {
  if (typeof window === 'undefined') return;

  const DEFAULT_TIMEOUT = 25000;
  const HOVER_STYLE = '2px dashed #fbbc05';
  const HIGHLIGHT_CHANNEL = '__camo_dom_picker';

  const domPickerState = {
    active: false,
    phase: 'idle', // 'idle' | 'hovering' | 'selected' | 'cancelled' | 'timeout'
    lastHover: null,
    selection: null,
    error: null,
    updatedAt: Date.now(),
  };

  const overlayApi = () => {
    const runtime = window.__camoRuntime;
    if (!runtime || !runtime.highlight || !runtime.highlight.highlightElements) {
      return null;
    }
    return runtime.highlight;
  };

  const setState = (patch) => {
    Object.assign(domPickerState, patch, { updatedAt: Date.now() });
  };

  const pickerShield = createPickerShield();

  function createPickerShield() {
    if (typeof window === 'undefined') return null;
    const SHIELD_CLASS = '__camo_picker_shield__';
    const instances = new Map();
    const observers = new Map();
    const frameLoadListeners = new Map();
    let callbacksRef = null;

    class ShieldInstance {
      constructor(frameWindow, frameElement, callbacks) {
        this.frameWindow = frameWindow;
        this.frameElement = frameElement || null;
        this.callbacks = callbacks || {};
        this.layer = null;
        this.bindings = null;
      }

      mount() {
        const doc = this.getDocument();
        if (!doc) return;
        if (this.layer && doc.contains(this.layer)) {
          return;
        }
        this.destroy();
        if (doc.readyState === 'loading') {
          doc.addEventListener('DOMContentLoaded', () => this.createLayer(doc), { once: true });
        } else {
          this.createLayer(doc);
        }
      }

      destroy() {
        this.unbindEvents();
        if (this.layer && this.layer.parentNode) {
          this.layer.parentNode.removeChild(this.layer);
        }
        this.layer = null;
      }

      getDocument() {
        try {
          return this.frameWindow.document;
        } catch {
          return null;
        }
      }

      createLayer(doc) {
        const host = doc.body || doc.documentElement;
        if (!host) return;
        const layer = doc.createElement('div');
        layer.className = SHIELD_CLASS;
        const style = layer.style;
        style.setProperty('position', 'fixed', 'important');
        style.setProperty('inset', '0', 'important');
        style.setProperty('width', '100vw', 'important');
        style.setProperty('height', '100vh', 'important');
        style.setProperty('z-index', '2147483646', 'important');
        style.setProperty('pointer-events', 'auto', 'important');
        style.setProperty('background', 'transparent', 'important');
        style.setProperty('cursor', 'crosshair', 'important');
        style.setProperty('touch-action', 'none', 'important');
        style.setProperty('user-select', 'none', 'important');
        style.setProperty('contain', 'strict', 'important');
        host.appendChild(layer);
        this.layer = layer;
        this.bindEvents();
      }

      bindEvents() {
        if (!this.layer) return;
        const win = this.frameWindow;
        const pointerMove = (e) => {
          this.consumeEvent(e);
          const target = this.resolveTarget(e);
          this.callbacks.onHover?.({
            target,
            event: e,
            frameWindow: this.frameWindow,
            frameElement: this.frameElement,
          });
        };
        const pointerDown = (e) => {
          this.consumeEvent(e);
          const target = this.resolveTarget(e);
          this.callbacks.onPointerDown?.({
            target,
            event: e,
            frameWindow: this.frameWindow,
            frameElement: this.frameElement,
          });
        };
        const pointerUp = (e) => {
          this.consumeEvent(e);
          const target = this.resolveTarget(e);
          this.callbacks.onPointerUp?.({
            target,
            event: e,
            frameWindow: this.frameWindow,
            frameElement: this.frameElement,
          });
        };
        const click = (e) => {
          this.consumeEvent(e);
          const target = this.resolveTarget(e);
          this.callbacks.onClick?.({
            target,
            event: e,
            frameWindow: this.frameWindow,
            frameElement: this.frameElement,
          });
        };
        const contextMenu = (e) => {
          this.consumeEvent(e);
        };
        win.addEventListener('pointermove', pointerMove, true);
        win.addEventListener('pointerdown', pointerDown, true);
        win.addEventListener('pointerup', pointerUp, true);
        win.addEventListener('pointercancel', pointerUp, true);
        win.addEventListener('click', click, true);
        win.addEventListener('contextmenu', contextMenu, true);
        this.bindings = { pointerMove, pointerDown, pointerUp, click, contextMenu };
      }

      unbindEvents() {
        if (!this.bindings) return;
        const { pointerMove, pointerDown, pointerUp, click, contextMenu } = this.bindings;
        const win = this.frameWindow;
        win.removeEventListener('pointermove', pointerMove, true);
        win.removeEventListener('pointerdown', pointerDown, true);
        win.removeEventListener('pointerup', pointerUp, true);
        win.removeEventListener('pointercancel', pointerUp, true);
        win.removeEventListener('click', click, true);
        win.removeEventListener('contextmenu', contextMenu, true);
        this.bindings = null;
      }

      consumeEvent(e) {
        if (!e) return;
        try {
          e.preventDefault();
          e.stopPropagation();
          if (typeof e.stopImmediatePropagation === 'function') {
            e.stopImmediatePropagation();
          }
        } catch {
          /* ignore */
        }
      }

      resolveTarget(e) {
        if (!e) return null;
        const path = typeof e.composedPath === 'function' ? e.composedPath() : [];
        let fallbackCandidate = null;
        for (const node of path) {
          if (node instanceof Element && !this.isShieldElement(node)) {
            if (!fallbackCandidate) {
              fallbackCandidate = node;
            }
            const tag = node.tagName ? node.tagName.toLowerCase() : '';
            if (tag && tag !== 'html' && tag !== 'body') {
              return node;
            }
          }
        }
        const maybeTarget = e.target instanceof Element ? e.target : null;
        if (maybeTarget && !this.isShieldElement(maybeTarget)) {
          const tag = maybeTarget.tagName ? maybeTarget.tagName.toLowerCase() : '';
          if (tag && tag !== 'html' && tag !== 'body') {
            return maybeTarget;
          }
          if (!fallbackCandidate) {
            fallbackCandidate = maybeTarget;
          }
        }
        const alt = this.elementFromPointSafely(e);
        if (alt && !this.isShieldElement(alt)) {
          return alt;
        }
        return fallbackCandidate;
      }

      isShieldElement(el) {
        if (!(el instanceof Element)) return false;
        return el.classList.contains(SHIELD_CLASS);
      }

      elementFromPointSafely(e) {
        const doc = this.getDocument();
        if (!doc || typeof e.clientX !== 'number' || typeof e.clientY !== 'number') return null;
        const originalDisplay = this.layer ? this.layer.style.display : '';
        if (this.layer) {
          this.layer.style.display = 'none';
        }
        let result = null;
        try {
          const candidate = doc.elementFromPoint(e.clientX, e.clientY);
          if (candidate instanceof Element && !this.isShieldElement(candidate)) {
            result = candidate;
          }
        } catch {
          result = null;
        } finally {
          if (this.layer) {
            this.layer.style.display = originalDisplay || '';
          }
        }
        return result;
      }
    }

    const attachToWindow = (targetWindow, frameElement) => {
      if (!callbacksRef || instances.has(targetWindow)) return;
      const instance = new ShieldInstance(targetWindow, frameElement, callbacksRef);
      instances.set(targetWindow, instance);
      instance.mount();
      observeFrames(targetWindow);
    };

    const observeFrames = (targetWindow) => {
      const doc = getDocumentSafe(targetWindow);
      if (!doc) return;
      const observer = new MutationObserver(() => scanFrames(targetWindow));
      observer.observe(doc.documentElement || doc, { childList: true, subtree: true });
      observers.set(targetWindow, observer);
      scanFrames(targetWindow);
    };

    const scanFrames = (targetWindow) => {
      const doc = getDocumentSafe(targetWindow);
      if (!doc) return;
      const frames = Array.from(doc.querySelectorAll('iframe'));
      frames.forEach((frame) => tryAttachFrame(frame));
    };

    const tryAttachFrame = (frame) => {
      if (!frame || !frame.contentWindow) return;
      const childWindow = frame.contentWindow;
      if (instances.has(childWindow)) {
        instances.get(childWindow)?.mount();
        return;
      }
      try {
        // eslint-disable-next-line no-unused-expressions
        childWindow.document;
      } catch {
        markFrameUnavailable(frame);
        return;
      }
      attachToWindow(childWindow, frame);
      frame.dataset.__camoPickerAttached = 'true';
      const reloadHandler = () => tryAttachFrame(frame);
      frame.addEventListener('load', reloadHandler);
      frameLoadListeners.set(frame, reloadHandler);
    };

    const markFrameUnavailable = (frame) => {
      frame.dataset.__camoPickerBlocked = 'true';
      if (callbacksRef?.onFrameBlocked) {
        try {
          callbacksRef.onFrameBlocked(frame);
        } catch {
          /* ignore */
        }
      }
    };

    const detachAll = () => {
      instances.forEach((instance) => instance.destroy());
      instances.clear();
      observers.forEach((observer) => observer.disconnect());
      observers.clear();
      frameLoadListeners.forEach((listener, frame) => {
        frame.removeEventListener('load', listener);
      });
      frameLoadListeners.clear();
    };

    const getDocumentSafe = (targetWindow) => {
      try {
        return targetWindow.document;
      } catch {
        return null;
      }
    };

    return {
      attach(cb) {
        detachAll();
        callbacksRef = cb || null;
        if (!callbacksRef) return;
        attachToWindow(window, null);
      },
      detach() {
        detachAll();
        callbacksRef = null;
      },
    };
  }

  const core = {
    _session: null,

    _ensureStopped() {
      if (!this._session) return;
      try {
        this._session.stop();
      } catch {}
      this._session = null;
    },

    startSession(options) {
      const mode = (options && options.mode) || 'hover-select';
      const timeoutMs = Math.min(Math.max(Number(options && options.timeoutMs) || DEFAULT_TIMEOUT, 1000), 60000);
      const rootSelector = (options && (options.rootSelector || options.root_selector)) || null;

      this._ensureStopped();

      const session = createSession({ mode, timeoutMs, rootSelector });
      this._session = session;
      session.start();
      return this.getLastState();
    },

    cancel() {
      if (this._session) {
        this._session.cancel('cancelled-by-host');
      }
      return this.getLastState();
    },

    getLastState() {
      // return shallow-cloned, read-only-ish snapshot
      return JSON.parse(JSON.stringify(domPickerState));
    },
  };

  function createSession(config) {
    const mode = config.mode || 'hover-select';
    const timeoutMs = config.timeoutMs || DEFAULT_TIMEOUT;
    const rootSelector = config.rootSelector || null;

    let active = false;
    let timeoutToken = null;

    let lastHoverEl = null;
    let shieldActive = false;

    const listeners = [];

    const detachShield = () => {
      if (pickerShield && shieldActive) {
        try {
          pickerShield.detach();
        } catch {
          /* ignore */
        }
        shieldActive = false;
      }
    };

    const addListener = (target, type, handler, options) => {
      target.addEventListener(type, handler, options || true);
      listeners.push(() => {
        try {
          target.removeEventListener(type, handler, options || true);
        } catch {}
      });
    };

    const clearHighlight = () => {
      const api = overlayApi();
      if (!api || !api.clear) return;
      try {
        api.clear(HIGHLIGHT_CHANNEL);
      } catch {}
    };

    const highlightEl = (el) => {
      const api = overlayApi();
      if (!api || !api.highlightElements) return;
      if (!el) {
        clearHighlight();
        return;
      }
      try {
        api.highlightElements([el], {
          channel: HIGHLIGHT_CHANNEL,
          style: HOVER_STYLE,
          duration: 0,
          sticky: true,
          maxMatches: 1,
        });
      } catch {}
    };

    const isRootLike = (el) => {
      if (!el || !el.tagName) return false;
      const tag = el.tagName.toLowerCase();
      if (tag === 'html' || tag === 'body') return true;
      if (el.id && el.id.toLowerCase() === 'app') return true;
      return false;
    };

    const extractSelector = (el) => {
      if (!el) return null;
      if (el.id) return `#${el.id}`;
      if (el.classList && el.classList.length) {
        return `${el.tagName.toLowerCase()}.${Array.from(el.classList).join('.')}`;
      }
      return el.tagName ? el.tagName.toLowerCase() : null;
    };

    const extractPath = (el) => {
      if (!el) return null;
      try {
        const runtime = window.__camoRuntime;
        if (!runtime || !runtime.dom || !runtime.dom.buildPathForElement) {
          console.warn('[dom-picker] buildPathForElement missing');
          return null;
        }
        console.log('[dom-picker] extractPath rootSelector:', rootSelector);
        const path = runtime.dom.buildPathForElement(el, rootSelector);
        console.log('[dom-picker] extractPath result:', path);
        return path;
      } catch (err) {
        console.warn('[dom-picker] extractPath error', err);
        return null;
      }
    };

    const extractRect = (el) => {
      if (!el || !el.getBoundingClientRect) return null;
      const rect = el.getBoundingClientRect();
      return {
        x: Math.round(rect.left),
        y: Math.round(rect.top),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      };
    };

    const extractText = (el) => {
      if (!el) return '';
      return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    };

    const pickElementFromPoint = (x, y, event) => {
      const elements = (typeof document.elementsFromPoint === 'function'
        ? document.elementsFromPoint(x, y)
        : []);
      const stack = Array.isArray(elements) ? elements : [];

      const rejectSet = new Set();

      // Exclude overlays created by our highlight layer
      const overlayLayer = document.getElementById('__camo_highlight_layer');
      if (overlayLayer && overlayLayer.contains) {
        stack.forEach((el) => {
          if (overlayLayer.contains(el)) rejectSet.add(el);
        });
      }

      for (let i = 0; i < stack.length; i += 1) {
        const el = stack[i];
        if (!(el instanceof Element)) continue;
        if (rejectSet.has(el)) continue;
        if (isRootLike(el)) continue;
        return el;
      }

      // Fallback using elementFromPoint
      const fallback = document.elementFromPoint(x, y);
      if (fallback instanceof Element && !isRootLike(fallback)) {
        if (!rejectSet.has(fallback)) return fallback;
      }

      // Last resort: event target
      if (event && event.target && event.target instanceof Element && !isRootLike(event.target)) {
        return event.target;
      }

      return null;
    };

    const updateHover = (el) => {
      lastHoverEl = el;
      if (!el) {
        setState({ phase: active ? 'hovering' : domPickerState.phase, lastHover: null });
        clearHighlight();
        return;
      }
      const path = extractPath(el);
      const selector = extractSelector(el);
      setState({
        phase: 'hovering',
        lastHover: {
          path: path || null,
          selector: selector || null,
        },
      });
      highlightEl(el);
    };

    const finalize = (result) => {
      console.log('[dom-picker] finalize called', result);
      if (!active) return;
      active = false;
      if (timeoutToken) {
        clearTimeout(timeoutToken);
        timeoutToken = null;
      }
      detachShield();
      listeners.forEach((fn) => {
        try {
          fn();
        } catch {}
      });
      clearHighlight();

      if (result && result.type === 'timeout') {
        setState({ phase: 'timeout', error: null, active: false });
        return;
      }
      if (result && result.type === 'cancel') {
        setState({ phase: 'cancelled', error: null, active: false });
        return;
      }
      if (result && result.type === 'error') {
        setState({ phase: 'cancelled', error: result.error || 'unknown-error', active: false });
        return;
      }
      if (result && result.type === 'select' && result.element) {
        const el = result.element;
        console.log('[dom-picker] finalize select element', el);
        const path = extractPath(el);
        console.log('[dom-picker] finalize path', path);
        const selector = extractSelector(el);
        const rect = extractRect(el);
        const text = extractText(el);
        const tag = el.tagName ? el.tagName.toLowerCase() : '';
        const id = el.id || null;
        const classes = Array.from(el.classList || []);

        setState({
          phase: 'selected',
          active: false,
          selection: {
            path: path || '',
            selector: selector || '',
            rect: rect || { x: 0, y: 0, width: 0, height: 0 },
            text,
            tag,
            id,
            classes,
          },
        });
        return;
      }

      // default: cancelled
      setState({ phase: 'cancelled', active: false });
    };

    const onPointerMove = (event, forcedTarget) => {
      if (!active) return;
      if (forcedTarget) {
        updateHover(forcedTarget);
        return;
      }
      const x = event?.clientX;
      const y = event?.clientY;
      if (typeof x === 'number' && typeof y === 'number') {
        const el = pickElementFromPoint(x, y, event);
        updateHover(el);
      } else {
        updateHover(null);
      }
    };

    const commitElement = (el, event) => {
      const target = el || lastHoverEl;
      if (!target && event) {
        const fallback = pickElementFromPoint(event.clientX, event.clientY, event);
        if (fallback) {
          finalize({ type: 'select', element: fallback });
          return;
        }
      }
      if (!target) {
        finalize({ type: 'error', error: 'no-element' });
        return;
      }
      finalize({ type: 'select', element: target });
    };

    const commitFromEvent = (event, forcedTarget) => {
      if (!event && !forcedTarget) {
        commitElement(null, null);
        return;
      }
      if (forcedTarget) {
        commitElement(forcedTarget, event || null);
        return;
      }
      const x = event?.clientX;
      const y = event?.clientY;
      const el = typeof x === 'number' && typeof y === 'number' ? pickElementFromPoint(x, y, event) : null;
      commitElement(el, event || null);
    };

    const onPointerDown = (event, forcedTarget) => {
      if (!active) return;
      if (event.button !== undefined && event.button !== 0) return;
      event.preventDefault();
      event.stopPropagation();
      commitFromEvent(event, forcedTarget || null);
    };

    const onMouseDown = (event, forcedTarget) => {
      if (!active) return;
      if (event.button !== 0) return; // left button only
      event.preventDefault();
      event.stopPropagation();
      commitFromEvent(event, forcedTarget || null);
    };

    const onKeyDown = (event) => {
      if (!active) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        finalize({ type: 'cancel' });
      }
    };

    const onWindowBlur = () => {
      if (!active) return;
      finalize({ type: 'cancel' });
    };

    const onWindowMouseOut = (event) => {
      if (!active) return;
      const next = event.relatedTarget || event.toElement;
      if (!next || next === window || next === document) {
        updateHover(null);
      }
    };

    const onScroll = () => {
      if (!active) return;
      if (lastHoverEl) highlightEl(lastHoverEl);
    };

    return {
      start() {
        active = true;
        setState({
          active: true,
          phase: 'hovering',
          lastHover: null,
          selection: null,
          error: null,
        });

        if (pickerShield) {
          let attached = false;
          try {
            pickerShield.attach({
            onHover: ({ target, event }) => {
              onPointerMove(event || null, target || null);
            },
            onPointerDown: ({ target, event }) => {
              onPointerDown(event || { button: 0 }, target || null);
            },
            onPointerUp: () => {
              /* no-op */
            },
            onClick: ({ target, event }) => {
              if (event) {
                try {
                  event.preventDefault();
                  event.stopPropagation();
                } catch {
                  /* ignore */
                }
              }
              commitFromEvent(event || null, target || null);
            },
            onFrameBlocked: (frame) => {
              try {
                // eslint-disable-next-line no-console
                console.warn('[dom-picker] frame blocked for shield', frame?.src || frame?.id || 'unknown');
              } catch {
                /* ignore */
              }
            },
          });
            attached = true;
          } catch (err) {
            // eslint-disable-next-line no-console
            console.warn('[dom-picker] pickerShield attach failed', err);
          }
          shieldActive = attached;
          if (!attached) {
            addListener(document, 'pointermove', onPointerMove, true);
            addListener(document, 'pointerdown', onPointerDown, true);
            addListener(document, 'mousedown', onMouseDown, true);
          }
        } else {
          addListener(document, 'pointermove', onPointerMove, true);
          addListener(document, 'pointerdown', onPointerDown, true);
          addListener(document, 'mousedown', onMouseDown, true);
        }
        addListener(document, 'keydown', onKeyDown, true);
        addListener(window, 'blur', onWindowBlur, true);
        addListener(window, 'scroll', onScroll, true);
        addListener(window, 'mouseout', onWindowMouseOut, true);

        timeoutToken = window.setTimeout(() => {
          finalize({ type: 'timeout' });
        }, timeoutMs);
      },
      cancel(reason) {
        if (!active) return;
        finalize({ type: 'cancel', reason: reason || 'cancelled' });
      },
      stop() {
        if (!active) return;
        finalize({ type: 'cancel', reason: 'stopped' });
      },
    };
  }

  const api = {
    startSession: (options) => core.startSession(options || {}),
    cancel: () => core.cancel(),
    getLastState: () => core.getLastState(),
  };

  Object.defineProperty(window, '__domPicker', {
    value: api,
    configurable: true,
    enumerable: false,
    writable: false,
  });
})();

// __DOM_PICKER_INLINE_END
(function attachDomPickerLoopback() {
  if (typeof window === 'undefined') return;

  function delay(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function findElementCenter(selector) {
    const el = typeof selector === 'string' ? document.querySelector(selector) : selector;
    if (!el) return null;
    const rect = el.getBoundingClientRect();
    if (!rect || !Number.isFinite(rect.left)) return null;
    const vw = Math.max(1, window.innerWidth || document.documentElement.clientWidth || 1);
    const vh = Math.max(1, window.innerHeight || document.documentElement.clientHeight || 1);
    const inset = 6;
    const clamp = (v, min, max) => Math.min(Math.max(v, min), max);
    const safeLeft = Math.max(rect.left + inset, inset);
    const safeRight = Math.min(rect.right - inset, vw - inset);
    const safeTop = Math.max(rect.top + inset, inset);
    const safeBottom = Math.min(rect.bottom - inset, vh - inset);
    const cx = safeRight >= safeLeft ? (safeLeft + safeRight) / 2 : rect.left + rect.width / 2;
    const cy = safeBottom >= safeTop ? (safeTop + safeBottom) / 2 : rect.top + rect.height / 2;
    return {
      x: Math.round(clamp(cx, inset, vw - inset)),
      y: Math.round(clamp(cy, inset, vh - inset)),
      rect,
      element: el,
    };
  }

  async function hoverLoopCheck(selector, options = {}) {
    const picker = window.__domPicker;
    if (!picker || typeof picker.startSession !== 'function') {
      return { error: 'domPicker unavailable' };
    }
    const center = findElementCenter(selector);
    if (!center) return { error: 'element_not_found', selector };
    const runtime = window.__camoRuntime;
    const buildPath = runtime?.dom?.buildPathForElement;
    const targetPath = buildPath && center.element instanceof Element ? buildPath(center.element, null) : null;
    const fromPoint = document.elementFromPoint(center.x, center.y);
    const fromPointPath = buildPath && fromPoint instanceof Element ? buildPath(fromPoint, null) : null;
    // NOTE: Real mouse move should be triggered by Playwright (page.mouse.move).
    // Here we only start the session and wait for it to pick up the hover.
    const before = picker.getLastState?.();
    if (!before?.phase || before.phase === 'idle') {
      picker.startSession?.({ timeoutMs: options.timeoutMs || 8000 });
      await delay(16);
    }
    await delay(options.settleMs || 32);
    const after = picker.getLastState?.();
    const hoveredPath = after?.selection?.path || after?.hovered?.path || after?.selected?.path || after?.path || null;
    const overlayRect = after?.selection?.rect || after?.hovered?.rect || after?.selected?.rect || after?.rect || null;
    const matches = Boolean(targetPath && hoveredPath && hoveredPath === targetPath && overlayRect);
    return {
      selector,
      point: { x: center.x, y: center.y },
      targetRect: center.rect,
      hoveredPath,
      targetPath,
      fromPointPath,
      overlayRect,
      stateBefore: before,
      stateAfter: after,
      matches,
    };
  }

  // Expose loopback helper as part of domPicker runtime for system use.
  function ensureDomPickerRuntime() {
    if (!window.__domPicker) return;
    const picker = window.__domPicker;
    picker.hoverLoopCheck = hoverLoopCheck;
    picker.findElementCenter = findElementCenter;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', ensureDomPickerRuntime, { once: true });
  } else {
    ensureDomPickerRuntime();
  }
})();

(() => {
  if (typeof window === 'undefined') {
    return;
  }
  if (window.__camoRuntime && window.__camoRuntime.ready) {
    return;
  }

  window.__camoRuntimeBootCount = (window.__camoRuntimeBootCount || 0) + 1;

  const VERSION = '0.1.0';
  const DEFAULT_STYLE = null;
  const registry = new Map();

  function dispatchBridgeEvent(type, data = {}) {
    try {
      if (typeof window.camo_dispatch === 'function') {
        window.camo_dispatch({ ts: Date.now(), type, data });
      }
      window.dispatchEvent(new CustomEvent(`camo:${type}`, { detail: data }));
    } catch {
      /* ignore bridge errors */
    }
  }

  let handshakeNotified = false;
  function notifyHandshakeStatus(status) {
    if (handshakeNotified) return;
    handshakeNotified = true;
    dispatchBridgeEvent('handshake.status', {
      status,
      href: window.location.href,
      hostname: window.location.hostname,
      runtimeVersion: VERSION,
      bootCount: window.__camoRuntimeBootCount || 1,
    });
  }

  const domUtils = {
    resolveRoot(selector) {
      if (selector) {
        try {
          const explicit = document.querySelector(selector);
          if (explicit) return explicit;
        } catch {
          /* ignore invalid selector */
        }
      }
      return document.body || document.documentElement;
    },
    resolveByPath(path, selector) {
      if (!path || typeof path !== 'string') return null;
      const parts = path.split('/').filter(Boolean);
      if (!parts.length || parts[0] !== 'root') return null;
      let current = domUtils.resolveRoot(selector);
      for (let i = 1; i < parts.length; i += 1) {
        if (!current) break;
        const idx = Number(parts[i]);
        if (Number.isNaN(idx)) return null;
        const children = current.children || [];
        current = children[idx] || null;
      }
      return current;
    },
    buildPathForElement(el, selector) {
      if (!el || !(el instanceof Element)) return null;
      const root = domUtils.resolveRoot(selector);
      const indices = [];
      let cursor = el;
      let guard = 0;
      while (cursor && guard < 200) {
        if (cursor === root) {
          indices.push('root');
          break;
        }
        const parent = cursor.parentElement;
        if (!parent) break;
        const idx = Array.prototype.indexOf.call(parent.children || [], cursor);
        indices.push(String(idx));
        cursor = parent;
        guard += 1;
      }
      if (!indices.length) return null;
      if (indices[indices.length - 1] !== 'root') {
        indices.push('root');
      }
      return indices.reverse().join('/');
    },
    snapshotNode(el, options = {}) {
      if (!el || !(el instanceof Element)) return null;
      const path = domUtils.buildPathForElement(el, options.rootSelector);
      const childLimit = Number(options.maxChildren || 20);
      const depthLimit = Number(options.maxDepth || 3);
      return domUtils.collectNode(el, {
        path: path || 'root',
        depth: 0,
        depthLimit,
        childLimit,
        forcePaths: options.forcePaths || []
      });
    },
    collectNode(el, ctx) {
      if (!el || !(el instanceof Element)) return null;
      const node = {
        path: ctx.path,
        tag: el.tagName ? el.tagName.toLowerCase() : 'node',
        id: el.id || null,
        classes: Array.from(el.classList || []),
        textSnippet: domUtils.extractText(el),
        text: domUtils.extractText(el),
        childCount: el.children ? el.children.length : 0,
        children: [],
      };

      // Check if current path needs to be expanded (depthLimit override)
      let shouldExpand = ctx.depth < ctx.depthLimit;
      if (!shouldExpand && ctx.forcePaths && ctx.forcePaths.length > 0) {
        for (const fp of ctx.forcePaths) {
          if (fp.startsWith(ctx.path + '/')) {
            shouldExpand = true;
            break;
          }
        }
      }

      if (shouldExpand && el.children && el.children.length) {
        const maxChildren = Math.max(1, ctx.childLimit);
        const totalChildren = el.children.length;
        const defaultCount = Math.min(totalChildren, maxChildren);
        const indices = new Set();

        for (let i = 0; i < defaultCount; i += 1) {
          indices.add(i);
        }

        if (ctx.forcePaths && ctx.forcePaths.length > 0) {
          const prefix = `${ctx.path}/`;
          for (const fp of ctx.forcePaths) {
            if (!fp.startsWith(prefix)) continue;
            const rest = fp.slice(prefix.length);
            const next = rest.split('/')[0];
            const idx = Number(next);
            if (!Number.isNaN(idx) && idx >= 0 && idx < totalChildren) {
              indices.add(idx);
            }
          }
        }

        const ordered = Array.from(indices).sort((a, b) => a - b);
        for (const i of ordered) {
          const child = el.children[i];
          const childPath = `${ctx.path}/${i}`;
          const result = domUtils.collectNode(child, {
            path: childPath,
            depth: ctx.depth + 1,
            depthLimit: ctx.depthLimit,
            childLimit: ctx.childLimit,
            forcePaths: ctx.forcePaths
          });
          if (result) {
            node.children.push(result);
          }
        }
      }
      return node;
    },
    extractText(el) {
      if (!el) return '';
      return (el.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 160);
    },
  };

  function ensureOverlayLayer() {
    let layer = document.getElementById('__camo_highlight_layer');
    if (layer && layer.parentElement === document.body) return layer;
    if (!layer) {
      layer = document.createElement('div');
      layer.id = '__camo_highlight_layer';
    }
    Object.assign(layer.style, {
      position: 'fixed',
      left: '0',
      top: '0',
      width: '100%',
      height: '100%',
      pointerEvents: 'none',
      zIndex: '2147483646',
    });
    if (!layer.parentElement) {
      document.body.appendChild(layer);
    }
    return layer;
  }

  function createOverlay(rect, style) {
    const layer = ensureOverlayLayer();
    const el = document.createElement('div');
    el.className = '__camo_highlight_box';
    Object.assign(el.style, {
      position: 'absolute',
      boxSizing: 'border-box',
      left: `${Math.round(rect.x)}px`,
      top: `${Math.round(rect.y)}px`,
      width: `${Math.max(0, Math.round(rect.width))}px`,
      height: `${Math.max(0, Math.round(rect.height))}px`,
      pointerEvents: 'none',
      ...style,
    });
    layer.appendChild(el);
    return el;
  }

  function removeOverlay(overlay) {
    if (overlay && overlay.parentElement) {
      overlay.parentElement.removeChild(overlay);
    }
  }

  function clearChannel(channel) {
    const key = channel || 'default';
    const entry = registry.get(key);
    if (entry) {
      if (Array.isArray(entry.items)) {
        entry.items.forEach((item) => {
          try { removeOverlay(item.overlay); } catch {}
        });
      } else if (Array.isArray(entry.overlays)) {
        entry.overlays.forEach((ov) => {
          try { removeOverlay(ov); } catch {}
        });
      }
    }
    registry.delete(key);
  }

  let scrollListenerInitialized = false;

  function updateAllOverlays() {
    registry.forEach((entry) => {
      if (entry && Array.isArray(entry.items)) {
        entry.items.forEach(({ overlay, element }) => {
          if (!element || !element.isConnected || !overlay) return;
          const rect = element.getBoundingClientRect();
          if (rect.width > 0 && rect.height > 0) {
             Object.assign(overlay.style, {
                left: `${Math.round(rect.x)}px`,
                top: `${Math.round(rect.y)}px`,
                width: `${Math.round(rect.width)}px`,
                height: `${Math.round(rect.height)}px`,
                display: 'block'
             });
          } else {
             overlay.style.display = 'none';
          }
        });
      }
    });
  }

  function setupScrollListener() {
    if (scrollListenerInitialized) return;
    scrollListenerInitialized = true;
    
    let ticking = false;
    const handler = () => {
       if (!ticking) {
         window.requestAnimationFrame(() => {
           updateAllOverlays();
           ticking = false;
         });
         ticking = true;
       }
    };
    
    window.addEventListener('scroll', handler, { capture: true, passive: true });
    window.addEventListener('resize', handler, { passive: true });
  }


  function highlightNodes(nodes, options = {}) {
    const channel = options.channel || 'default';
    const style = options.style || '2px solid rgba(255, 193, 7, 0.9)';
    const borderStyle = typeof style === 'string' ? { border: style, borderRadius: '4px' } : style;

    const prev = registry.get(channel);
    if (prev) {
      if (Array.isArray(prev.items)) {
        prev.items.forEach((item) => {
          try { removeOverlay(item.overlay); } catch {}
        });
      } else if (Array.isArray(prev.overlays)) {
        prev.overlays.forEach((ov) => {
          try { removeOverlay(ov); } catch {}
        });
      }
    }

    const items = [];
    const overlays = [];
    const list = Array.isArray(nodes) ? nodes : [];
    list.forEach((node) => {
      if (!(node instanceof Element)) return;
      const rect = node.getBoundingClientRect();
      if (!rect || !rect.width || !rect.height) return;
      const overlay = createOverlay(rect, borderStyle);
      items.push({ overlay, element: node });
      overlays.push(overlay);
    });

    registry.set(channel, {
      items,
      overlays,
      sticky: Boolean(options.sticky || options.hold),
      cleanup: () => {
        items.forEach((item) => {
          try {
            removeOverlay(item.overlay);
          } catch {}
        });
      },
    });
    
    setupScrollListener();

    if (!options.sticky && !options.hold) {
      const duration = Number(options.duration || 0);
      if (duration > 0) {
        setTimeout(() => {
          clearChannel(channel);
        }, duration);
      }
    }

    return { selector: options.selector || null, count: items.length, channel };
  }

  function highlightSelector(selector, options = {}) {
    const rootSelector = options.rootSelector || null;
    const root = domUtils.resolveRoot(rootSelector);
    if (!root || !selector) {
      clearChannel(options.channel);
      return { selector: selector || null, count: 0, channel: options.channel || 'default' };
    }
    let nodes = [];
    try {
      const scope = rootSelector ? root : document;
      if (scope === root && typeof root.matches === 'function' && root.matches(selector)) {
        nodes.push(root);
      }
      nodes = nodes.concat(Array.from(scope.querySelectorAll(selector)));
    } catch {
      nodes = [];
    }
    return highlightNodes(nodes, { ...options, selector });
  }

  function getDomBranch(path, options = {}) {
    const root = domUtils.resolveRoot(options.rootSelector);
    if (!root) {
      return {
        node: null,
        error: 'root-not-found',
      };
    }
    let target = root;
    if (path && path !== 'root') {
      target = domUtils.resolveByPath(path, options.rootSelector) || root;
    }
    // Extract forcePaths if provided
    const forcePaths = Array.isArray(options.forcePaths) ? options.forcePaths : [];

    const node = domUtils.snapshotNode(target, { ...options, forcePaths });
    return {
      node,
      path: node?.path || 'root',
      capturedAt: Date.now(),
    };
  }

  function getNodeDetails(path, options = {}) {
    const el = domUtils.resolveByPath(path, options.rootSelector);
    if (!el) {
      return { path, exists: false };
    }
    const rect = el.getBoundingClientRect();
    return {
      path,
      exists: true,
      tag: el.tagName ? el.tagName.toLowerCase() : 'node',
      id: el.id || null,
      classes: Array.from(el.classList || []),
      text: domUtils.extractText(el),
      boundingRect: {
        x: rect.left,
        y: rect.top,
        width: rect.width,
        height: rect.height,
      },
    };
  }

  function bootRuntime() {
    // dom-picker bootstrap: ensure __domPicker is loaded if bundled separately
    try {
      // noop; domPicker.runtime.js attaches itself to window when included by loader
    } catch { /* ignore */ }

    const runtime = {
      version: VERSION,
      ready: true,
      highlight: {
        highlightSelector,
        highlightElements: highlightNodes,
        clear: clearChannel,
      },
      dom: {
        getBranch: getDomBranch,
        getNodeDetails,
        buildPathForElement: domUtils.buildPathForElement,
        resolveByPath: domUtils.resolveByPath,
      },
      getDomBranch,
      ping() {
        return { ts: Date.now(), href: window.location.href };
      },
      get domPicker() {
        return window.__domPicker || null;
      },
    };
    Object.defineProperty(window, '__camoRuntime', {
      value: runtime,
      configurable: true,
      enumerable: false,
      writable: false,
    });
    notifyHandshakeStatus('ready');
  }

  if (document.readyState === 'loading') {
    document.addEventListener(
      'DOMContentLoaded',
      () => {
        bootRuntime();
      },
      { once: true },
    );
  } else {
    bootRuntime();
  }
})();
