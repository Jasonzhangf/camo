function asBoolLiteral(value) {
  return value ? 'true' : 'false';
}

function buildVisibleElementResolverLiteral(selector) {
  return `
    const selector = ${JSON.stringify(selector)};
    const candidates = Array.from(document.querySelectorAll(selector));
    const isVisible = (node) => {
      if (!(node instanceof Element)) return false;
      const rect = node.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      try {
        const style = window.getComputedStyle(node);
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
    const hitVisible = (node) => {
      if (!(node instanceof Element)) return false;
      const rect = node.getBoundingClientRect?.();
      if (!rect) return false;
      const x = Math.max(0, Math.min((window.innerWidth || 1) - 1, rect.left + rect.width / 2));
      const y = Math.max(0, Math.min((window.innerHeight || 1) - 1, rect.top + rect.height / 2));
      const top = document.elementFromPoint(x, y);
      if (!top) return false;
      return top === node || node.contains(top) || top.contains(node);
    };
    const pick = () => {
      if (!candidates.length) return null;
      const strict = candidates.find((node) => isVisible(node) && hitVisible(node));
      if (strict) return strict;
      const visible = candidates.find((node) => isVisible(node));
      if (visible) return visible;
      return candidates[0] || null;
    };
    const el = pick();
    if (!el) throw new Error('Element not found: ' + selector);
    const matchedIndex = Math.max(0, candidates.indexOf(el));
  `;
}

export function buildSelectorScrollIntoViewScript({ selector, highlight }) {
  const highlightLiteral = asBoolLiteral(highlight);
  return `(async () => {
    ${buildVisibleElementResolverLiteral(selector)}
    const restoreOutline = el instanceof HTMLElement ? el.style.outline : '';
    if (${highlightLiteral} && el instanceof HTMLElement) {
      el.style.outline = '2px solid #ff4d4f';
    }
    el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
    await new Promise((r) => setTimeout(r, 120));
    if (${highlightLiteral} && el instanceof HTMLElement) {
      el.style.outline = restoreOutline;
    }
    return {
      ok: true,
      selector,
      matchedIndex,
      action: 'scrollIntoView',
      highlight: ${highlightLiteral},
      target: { tag: String(el.tagName || '').toLowerCase(), id: el.id || null }
    };
  })()`;
}

export function buildSelectorClickScript({ selector, highlight }) {
  const highlightLiteral = asBoolLiteral(highlight);
  return `(async () => {
    ${buildVisibleElementResolverLiteral(selector)}
    const restoreOutline = el instanceof HTMLElement ? el.style.outline : '';
    if (${highlightLiteral} && el instanceof HTMLElement) {
      el.style.outline = '2px solid #ff4d4f';
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await new Promise((r) => setTimeout(r, 150));
    if (el instanceof HTMLElement && typeof el.click === 'function') {
      el.click();
    } else {
      throw new Error('Target element is not clickable');
    }
    if (${highlightLiteral} && el instanceof HTMLElement) {
      setTimeout(() => { el.style.outline = restoreOutline; }, 260);
    }
    return {
      ok: true,
      selector,
      matchedIndex,
      action: 'click',
      highlight: ${highlightLiteral},
      target: { tag: String(el.tagName || '').toLowerCase(), id: el.id || null }
    };
  })()`;
}

export function buildSelectorTypeScript({ selector, highlight, text }) {
  const highlightLiteral = asBoolLiteral(highlight);
  const textLiteral = JSON.stringify(String(text || ''));
  const textLength = String(text || '').length;

  return `(async () => {
    ${buildVisibleElementResolverLiteral(selector)}
    const isTypeable = (node) => {
      if (!node) return false;
      if (node instanceof HTMLInputElement) return !node.disabled && !node.readOnly;
      if (node instanceof HTMLTextAreaElement) return !node.disabled && !node.readOnly;
      return node instanceof HTMLElement && node.isContentEditable;
    };
    if (!isTypeable(el)) {
      throw new Error('Target element is not typeable: ' + selector);
    }
    const restoreOutline = el instanceof HTMLElement ? el.style.outline : '';
    if (${highlightLiteral} && el instanceof HTMLElement) {
      el.style.outline = '2px solid #ff4d4f';
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await new Promise((r) => setTimeout(r, 150));
    if (el instanceof HTMLElement && typeof el.focus === 'function') {
      el.focus();
    }

    if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
      el.value = ${textLiteral};
    } else if (el instanceof HTMLElement && el.isContentEditable) {
      el.textContent = ${textLiteral};
    }

    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (${highlightLiteral} && el instanceof HTMLElement) {
      setTimeout(() => { el.style.outline = restoreOutline; }, 260);
    }
    return {
      ok: true,
      selector,
      matchedIndex,
      action: 'type',
      length: ${textLength},
      highlight: ${highlightLiteral},
      target: { tag: String(el.tagName || '').toLowerCase(), id: el.id || null }
    };
  })()`;
}

export function buildScrollTargetScript({ selector, highlight }) {
  const selectorLiteral = JSON.stringify(String(selector || '').trim() || null);
  const highlightLiteral = asBoolLiteral(highlight);
  return `(() => {
    const selector = ${selectorLiteral};
    const isVisible = (node) => {
      if (!(node instanceof Element)) return false;
      const rect = node.getBoundingClientRect?.();
      if (!rect || rect.width <= 0 || rect.height <= 0) return false;
      try {
        const style = window.getComputedStyle(node);
        if (!style) return false;
        if (style.display === 'none') return false;
        if (style.visibility === 'hidden' || style.visibility === 'collapse') return false;
      } catch {
        return false;
      }
      return true;
    };
    const isScrollable = (node) => {
      if (!(node instanceof Element)) return false;
      const style = window.getComputedStyle(node);
      const overflowY = String(style.overflowY || '');
      const overflowX = String(style.overflowX || '');
      const yScrollable = (overflowY.includes('auto') || overflowY.includes('scroll') || overflowY.includes('overlay'))
        && (node.scrollHeight - node.clientHeight > 2);
      const xScrollable = (overflowX.includes('auto') || overflowX.includes('scroll') || overflowX.includes('overlay'))
        && (node.scrollWidth - node.clientWidth > 2);
      return yScrollable || xScrollable;
    };
    const findScrollableAncestor = (node) => {
      let cursor = node instanceof Element ? node : null;
      while (cursor) {
        if (isVisible(cursor) && isScrollable(cursor)) return cursor;
        cursor = cursor.parentElement;
      }
      return null;
    };

    let target = null;
    let source = 'document';
    if (selector) {
      const list = Array.from(document.querySelectorAll(selector));
      target = list.find((node) => isVisible(node) && isScrollable(node))
        || list.find((node) => isVisible(node))
        || null;
      if (target) source = 'selector';
    }
    if (!target) {
      const active = document.activeElement instanceof Element ? document.activeElement : null;
      target = findScrollableAncestor(active);
      if (target) source = 'active';
    }
    if (!target) {
      const cx = Math.max(1, Math.floor((window.innerWidth || 1) / 2));
      const cy = Math.max(1, Math.floor((window.innerHeight || 1) / 2));
      const point = document.elementFromPoint(cx, cy);
      target = findScrollableAncestor(point);
      if (target) source = 'center';
    }
    if (!target) {
      target = document.scrollingElement || document.documentElement || document.body;
      source = 'document';
    }
    if (!target) {
      throw new Error('No scroll target available');
    }

    const rect = target.getBoundingClientRect?.() || {
      left: 0,
      top: 0,
      width: window.innerWidth || 1,
      height: window.innerHeight || 1,
    };
    const centerX = Math.max(1, Math.min((window.innerWidth || 1) - 1, Math.round(rect.left + Math.max(1, rect.width / 2))));
    const centerY = Math.max(1, Math.min((window.innerHeight || 1) - 1, Math.round(rect.top + Math.max(1, rect.height / 2))));

    const restoreOutline = target instanceof HTMLElement ? target.style.outline : '';
    if (${highlightLiteral} && target instanceof HTMLElement) {
      target.style.outline = '2px solid #ff4d4f';
      setTimeout(() => {
        target.style.outline = restoreOutline;
      }, 320);
    }

    return {
      ok: true,
      selector,
      source,
      highlight: ${highlightLiteral},
      center: { x: centerX, y: centerY },
      target: {
        tag: String(target.tagName || '').toLowerCase(),
        id: target.id || null
      }
    };
  })()`;
}
