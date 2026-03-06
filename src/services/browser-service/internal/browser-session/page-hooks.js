import { ensurePageRuntime } from '../pageRuntime.js';
export function createPageHooksManager(deps) {
    const bridgedPages = new WeakSet();
    const recorderBridgePages = new WeakSet();
    function setupPageHooks(page) {
        const profileTag = `[session:${deps.profileId}]`;
        const ensure = (reason) => {
            ensurePageRuntime(page, true).catch((err) => {
                console.warn(`${profileTag} ensure runtime failed (${reason})`, err?.message || err);
            });
        };
        bindRuntimeBridge(page);
        bindRecorderBridge(page);
        page.on('domcontentloaded', () => {
            ensure('domcontentloaded');
            const recording = deps.getRecording();
            if (recording.active) {
                void installRecorderRuntime(page, 'domcontentloaded');
            }
        });
        page.on('framenavigated', (frame) => {
            if (frame === page.mainFrame()) {
                ensure('framenavigated');
                deps.recordPageVisit(page, 'framenavigated');
            }
        });
        page.on('pageerror', (error) => {
            console.warn(`${profileTag} pageerror`, error?.message || error);
        });
        page.on('console', (msg) => {
            if (msg.type() === 'error') {
                console.warn(`${profileTag} console.error`, msg.text());
            }
        });
        ensure('initial');
        const recording = deps.getRecording();
        if (recording.active) {
            void installRecorderRuntime(page, 'initial');
        }
    }
    function bindRuntimeBridge(page) {
        if (bridgedPages.has(page))
            return;
        bridgedPages.add(page);
        page.exposeFunction('camo_dispatch', (evt) => {
            deps.emitRuntimeEvent({
                ...evt,
                pageUrl: page.url(),
            });
        }).catch((err) => {
            console.warn(`[session:${deps.profileId}] failed to expose camo_dispatch`, err?.message || err);
        });
    }
    function bindRecorderBridge(page) {
        if (recorderBridgePages.has(page))
            return;
        recorderBridgePages.add(page);
        page.exposeFunction('camo_recorder_dispatch', (evt) => {
            deps.handleRecorderEvent(page, evt);
        }).catch((err) => {
            console.warn(`[session:${deps.profileId}] failed to expose camo_recorder_dispatch`, err?.message || err);
        });
    }
    async function installRecorderRuntime(page, reason) {
        if (!page || page.isClosed())
            return;
        try {
            await page.evaluate(buildRecorderBootstrapScript());
        }
        catch {
            return;
        }
        const recording = deps.getRecording();
        if (recording.active) {
            await syncRecorderStateToPage(page).catch(() => { });
            deps.recordPageVisit(page, reason);
        }
    }
    async function syncRecorderStateToPage(page) {
        if (!page || page.isClosed())
            return;
        const recording = deps.getRecording();
        await page.evaluate((options) => {
            const runtime = window.__camoRecorderV1__;
            if (!runtime || typeof runtime.setOptions !== 'function')
                return null;
            return runtime.setOptions(options);
        }, { enabled: recording.enabled, overlay: recording.overlay });
    }
    async function destroyRecorderRuntimeOnPage(page) {
        if (!page || page.isClosed())
            return;
        await page.evaluate(() => {
            const runtime = window.__camoRecorderV1__;
            if (!runtime || typeof runtime.destroy !== 'function')
                return null;
            return runtime.destroy();
        });
    }
    return {
        setupPageHooks,
        bindRuntimeBridge,
        bindRecorderBridge,
        installRecorderRuntime,
        syncRecorderStateToPage,
        destroyRecorderRuntimeOnPage,
    };
}
export function buildRecorderBootstrapScript() {
    return RECORDER_BOOTSTRAP_SCRIPT;
}
const RECORDER_BOOTSTRAP_SCRIPT = `(() => {
    const KEY = '__camoRecorderV1__';
    if (window[KEY]) return window[KEY].getState();

    const state = {
      enabled: false,
      overlay: false,
      destroyed: false,
      scrollAt: 0,
      wheelAt: 0,
    };
    const listeners = [];
    const OVERLAY_ID = '__camo_recorder_toggle__';

    const now = () => Date.now();
    const safeText = (value, max = 160) => {
      if (typeof value !== 'string') return '';
      return value.replace(/\\s+/g, ' ').trim().slice(0, max);
    };
    const SENSITIVE_TEXT_RE = /(pass(word)?|pwd|secret|token|otp|one[\\s_-]?time|验证码|校验码|短信|sms|手机|phone|mail|邮箱|email)/i;
    const toNumber = (value, fallback = 0) => {
      const n = Number(value);
      return Number.isFinite(n) ? n : fallback;
    };
    const getAttr = (el, name) => {
      if (!(el instanceof Element)) return '';
      const value = el.getAttribute?.(name);
      return typeof value === 'string' ? value : '';
    };
    const hasSensitiveHint = (value) => SENSITIVE_TEXT_RE.test(String(value || ''));
    const isSensitiveElement = (el) => {
      if (!(el instanceof Element)) return false;
      const tag = String(el.tagName || '').toLowerCase();
      const type = String((el instanceof HTMLInputElement ? el.type : getAttr(el, 'type')) || '').toLowerCase();
      if (tag === 'input' && ['password', 'email', 'tel'].includes(type)) return true;
      const autocomplete = String(getAttr(el, 'autocomplete') || '').toLowerCase();
      if (autocomplete.includes('one-time-code') || autocomplete.includes('password')) return true;
      const hint = [
        el.id || '',
        getAttr(el, 'name'),
        getAttr(el, 'aria-label'),
        getAttr(el, 'placeholder'),
        autocomplete,
        String(el.className || ''),
      ].join(' ');
      return hasSensitiveHint(hint);
    };

    const isVisible = (el) => {
      if (!(el instanceof Element)) return false;
      const rect = el.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      try {
        const style = window.getComputedStyle(el);
        if (!style) return false;
        if (style.display === 'none') return false;
        if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
        const opacity = Number.parseFloat(String(style.opacity || '1'));
        if (Number.isFinite(opacity) && opacity <= 0.01) return false;
      } catch {
        return false;
      }
      return true;
    };

    const buildSelectorPath = (el) => {
      if (!(el instanceof Element)) return null;
      const parts = [];
      let cursor = el;
      let depth = 0;
      while (cursor && depth < 8) {
        const tag = String(cursor.tagName || '').toLowerCase();
        if (!tag) break;
        const id = cursor.id ? '#' + cursor.id : '';
        const cls = Array.from(cursor.classList || []).slice(0, 2).join('.');
        let piece = tag + id + (cls ? '.' + cls : '');
        if (!id) {
          const parent = cursor.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children).filter((item) => item.tagName === cursor.tagName);
            if (siblings.length > 1) {
              const nth = siblings.indexOf(cursor) + 1;
              piece += ':nth-of-type(' + nth + ')';
            }
          }
        }
        parts.unshift(piece);
        cursor = cursor.parentElement;
        depth += 1;
        if (id) break;
      }
      return parts.join(' > ');
    };

    const resolveElement = (target) => {
      if (target instanceof Element) return target;
      if (target && target.scrollingElement instanceof Element) return target.scrollingElement;
      if (document.activeElement instanceof Element) return document.activeElement;
      if (document.scrollingElement instanceof Element) return document.scrollingElement;
      return document.documentElement instanceof Element ? document.documentElement : null;
    };

    const buildElementPayload = (target) => {
      const el = resolveElement(target);
      if (!(el instanceof Element)) return null;
      const rect = el.getBoundingClientRect?.();
      const attrs = {};
      ['name', 'type', 'role', 'placeholder', 'aria-label'].forEach((key) => {
        const value = el.getAttribute?.(key);
        if (value) attrs[key] = String(value).slice(0, 120);
      });
      const sensitive = isSensitiveElement(el);
      let valueSnippet = null;
      const value = el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement ? el.value : null;
      if (typeof value === 'string' && value.length > 0) {
        valueSnippet = sensitive ? '[REDACTED]' : value.slice(0, 120);
      }
      return {
        tag: String(el.tagName || '').toLowerCase(),
        id: el.id || null,
        classes: Array.from(el.classList || []).slice(0, 6),
        selectorPath: buildSelectorPath(el),
        textSnippet: safeText(el.textContent || '', 120),
        attrs,
        valueSnippet,
        sensitive,
        visible: isVisible(el),
        rect: rect
          ? {
              x: Math.round(toNumber(rect.x, 0)),
              y: Math.round(toNumber(rect.y, 0)),
              width: Math.round(toNumber(rect.width, 0)),
              height: Math.round(toNumber(rect.height, 0)),
            }
          : null,
      };
    };

    const emit = (type, payload = {}) => {
      if (typeof window.camo_recorder_dispatch !== 'function') return;
      try {
        window.camo_recorder_dispatch({
          ts: now(),
          type,
          payload,
          href: String(window.location?.href || ''),
          title: safeText(String(document?.title || ''), 200),
        });
      } catch {
        // ignore bridge errors
      }
    };

    const shouldRecord = (event) => {
      if (state.destroyed || !state.enabled) return false;
      if (!event) return false;
      if (typeof event.isTrusted === 'boolean' && !event.isTrusted) return false;
      return true;
    };

    const onClick = (event) => {
      if (!shouldRecord(event)) return;
      emit('interaction.click', {
        button: Number(event.button || 0),
        buttons: Number(event.buttons || 0),
        element: buildElementPayload(event.target),
      });
    };

    const onKeyDown = (event) => {
      if (!shouldRecord(event)) return;
      const element = buildElementPayload(event.target || document.activeElement);
      const isPrintable = typeof event.key === 'string' && event.key.length === 1;
      const redactKey = !!element?.sensitive || (isPrintable && !event.ctrlKey && !event.metaKey && !event.altKey);
      emit('interaction.keydown', {
        key: redactKey ? '[REDACTED]' : String(event.key || ''),
        code: String(event.code || ''),
        ctrlKey: !!event.ctrlKey,
        metaKey: !!event.metaKey,
        altKey: !!event.altKey,
        shiftKey: !!event.shiftKey,
        redacted: redactKey,
        element,
      });
    };

    const onInput = (event) => {
      if (!shouldRecord(event)) return;
      const element = buildElementPayload(event.target || document.activeElement);
      const rawData = typeof event.data === 'string' ? event.data : '';
      const redactData = !!element?.sensitive;
      emit('interaction.input', {
        inputType: String(event.inputType || ''),
        data: redactData ? '[REDACTED]' : safeText(rawData, 80),
        dataLength: rawData.length,
        redacted: redactData,
        element,
      });
    };

    const onWheel = (event) => {
      if (!shouldRecord(event)) return;
      const ts = now();
      if (ts - state.wheelAt < 120) return;
      state.wheelAt = ts;
      emit('interaction.wheel', {
        deltaX: toNumber(event.deltaX, 0),
        deltaY: toNumber(event.deltaY, 0),
        deltaMode: Number(event.deltaMode || 0),
        element: buildElementPayload(event.target),
      });
    };

    const onScroll = (event) => {
      if (!shouldRecord(event)) return;
      const ts = now();
      if (ts - state.scrollAt < 150) return;
      state.scrollAt = ts;
      const target = resolveElement(event.target || document.scrollingElement);
      const scrollTop = target && typeof target.scrollTop === 'number'
        ? target.scrollTop
        : (window.scrollY || document.documentElement.scrollTop || 0);
      const scrollLeft = target && typeof target.scrollLeft === 'number'
        ? target.scrollLeft
        : (window.scrollX || document.documentElement.scrollLeft || 0);
      emit('interaction.scroll', {
        scrollTop: Math.round(toNumber(scrollTop, 0)),
        scrollLeft: Math.round(toNumber(scrollLeft, 0)),
        element: buildElementPayload(target),
      });
    };

    const addListener = (target, type, handler, options) => {
      target.addEventListener(type, handler, options);
      listeners.push(() => {
        try {
          target.removeEventListener(type, handler, options);
        } catch {
          // ignore
        }
      });
    };

    const getOverlayButton = () => document.getElementById(OVERLAY_ID);
    const applyOverlay = () => {
      const existing = getOverlayButton();
      if (existing && !state.overlay) {
        existing.remove();
        return;
      }
      if (!state.overlay) return;
      const btn = existing || document.createElement('button');
      btn.id = OVERLAY_ID;
      btn.type = 'button';
      btn.textContent = state.enabled ? 'REC ON' : 'REC OFF';
      Object.assign(btn.style, {
        position: 'fixed',
        right: '16px',
        bottom: '16px',
        zIndex: '2147483647',
        border: '0',
        borderRadius: '999px',
        background: state.enabled ? '#d63636' : '#5b6575',
        color: '#fff',
        padding: '8px 12px',
        fontSize: '12px',
        fontFamily: 'monospace',
        cursor: 'pointer',
        boxShadow: '0 4px 14px rgba(0,0,0,0.25)',
      });
      if (!existing) {
        btn.addEventListener('click', () => {
          state.enabled = !state.enabled;
          applyOverlay();
          emit('recording.toggled', { enabled: state.enabled, source: 'overlay' });
        });
        (document.body || document.documentElement || document).appendChild(btn);
      }
    };

    addListener(document, 'click', onClick, true);
    addListener(document, 'keydown', onKeyDown, true);
    addListener(document, 'input', onInput, true);
    addListener(window, 'wheel', onWheel, { capture: true, passive: true });
    addListener(window, 'scroll', onScroll, { capture: true, passive: true });

    const api = {
      setOptions(options = {}) {
        if (typeof options.enabled === 'boolean') {
          state.enabled = options.enabled;
        }
        if (typeof options.overlay === 'boolean') {
          state.overlay = options.overlay;
        }
        applyOverlay();
        return this.getState();
      },
      getState() {
        return {
          ok: true,
          enabled: !!state.enabled,
          overlay: !!state.overlay,
          href: String(window.location?.href || ''),
        };
      },
      destroy() {
        state.destroyed = true;
        while (listeners.length) {
          const dispose = listeners.pop();
          try {
            dispose && dispose();
          } catch {
            // ignore
          }
        }
        const existing = getOverlayButton();
        if (existing) existing.remove();
        try {
          delete window[KEY];
        } catch {
          window[KEY] = undefined;
        }
        return { ok: true };
      },
    };

    window[KEY] = api;
    applyOverlay();
    emit('recording.runtime_ready', { enabled: state.enabled, overlay: state.overlay });
    return api.getState();
  })();`;
//# sourceMappingURL=page-hooks.js.map