function asBoolLiteral(value) {
  return value ? 'true' : 'false';
}

export function buildSelectorScrollIntoViewScript({ selector, highlight }) {
  const selectorLiteral = JSON.stringify(selector);
  const highlightLiteral = asBoolLiteral(highlight);
  return `(async () => {
    const el = document.querySelector(${selectorLiteral});
    if (!el) throw new Error('Element not found: ' + ${selectorLiteral});
    const restoreOutline = el instanceof HTMLElement ? el.style.outline : '';
    if (${highlightLiteral} && el instanceof HTMLElement) {
      el.style.outline = '2px solid #ff4d4f';
    }
    el.scrollIntoView({ behavior: 'auto', block: 'center', inline: 'nearest' });
    await new Promise((r) => setTimeout(r, 120));
    if (${highlightLiteral} && el instanceof HTMLElement) {
      el.style.outline = restoreOutline;
    }
    return { ok: true, selector: ${selectorLiteral} };
  })()`;
}

export function buildSelectorClickScript({ selector, highlight }) {
  const selectorLiteral = JSON.stringify(selector);
  const highlightLiteral = asBoolLiteral(highlight);
  return `(async () => {
    const el = document.querySelector(${selectorLiteral});
    if (!el) throw new Error('Element not found: ' + ${selectorLiteral});
    const restoreOutline = el instanceof HTMLElement ? el.style.outline : '';
    if (${highlightLiteral} && el instanceof HTMLElement) {
      el.style.outline = '2px solid #ff4d4f';
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await new Promise((r) => setTimeout(r, 150));
    el.click();
    if (${highlightLiteral} && el instanceof HTMLElement) {
      setTimeout(() => { el.style.outline = restoreOutline; }, 260);
    }
    return { ok: true, selector: ${selectorLiteral}, action: 'click', highlight: ${highlightLiteral} };
  })()`;
}

export function buildSelectorTypeScript({ selector, highlight, text }) {
  const selectorLiteral = JSON.stringify(selector);
  const highlightLiteral = asBoolLiteral(highlight);
  const textLiteral = JSON.stringify(String(text || ''));
  const textLength = String(text || '').length;

  return `(async () => {
    const el = document.querySelector(${selectorLiteral});
    if (!el) throw new Error('Element not found: ' + ${selectorLiteral});
    const restoreOutline = el instanceof HTMLElement ? el.style.outline : '';
    if (${highlightLiteral} && el instanceof HTMLElement) {
      el.style.outline = '2px solid #ff4d4f';
    }
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    await new Promise((r) => setTimeout(r, 150));
    el.focus();
    el.value = ${textLiteral};
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    if (${highlightLiteral} && el instanceof HTMLElement) {
      setTimeout(() => { el.style.outline = restoreOutline; }, 260);
    }
    return { ok: true, selector: ${selectorLiteral}, action: 'type', length: ${textLength}, highlight: ${highlightLiteral} };
  })()`;
}
