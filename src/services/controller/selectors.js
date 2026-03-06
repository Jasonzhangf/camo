export function normalizeSelectors(rawSelectors) {
  const out = [];
  const pushCss = (css, extra = {}) => {
    if (typeof css !== 'string' || !css.trim()) return;
    out.push({
      css: css.trim(),
      ...(typeof extra.variant === 'string' ? { variant: extra.variant } : {}),
      ...(Number.isFinite(Number(extra.score)) ? { score: Number(extra.score) } : {}),
    });
  };

  const splitLegacySelector = (rawSelector) => {
    if (typeof rawSelector !== 'string') return [];
    return rawSelector
      .split(',')
      .map((item) => item.trim())
      .filter(Boolean);
  };

  if (Array.isArray(rawSelectors)) {
    for (const item of rawSelectors) {
      if (typeof item === 'string') {
        for (const css of splitLegacySelector(item)) pushCss(css);
        continue;
      }
      if (item && typeof item === 'object') {
        if (typeof item.css === 'string') {
          pushCss(item.css, item);
        } else if (typeof item.selector === 'string') {
          for (const css of splitLegacySelector(item.selector)) pushCss(css, item);
        } else if (typeof item.id === 'string' && item.id) {
          pushCss(`#${item.id}`, item);
        } else if (Array.isArray(item.classes) && item.classes.length > 0) {
          pushCss(`.${item.classes.filter(Boolean).join('.')}`, item);
        }
      }
    }
  } else if (typeof rawSelectors === 'string') {
    for (const css of splitLegacySelector(rawSelectors)) pushCss(css);
  } else if (rawSelectors && typeof rawSelectors === 'object') {
    if (typeof rawSelectors.css === 'string') {
      pushCss(rawSelectors.css, rawSelectors);
    } else if (typeof rawSelectors.selector === 'string') {
      for (const css of splitLegacySelector(rawSelectors.selector)) pushCss(css, rawSelectors);
    }
  }

  const dedup = new Map();
  for (const item of out) {
    const key = `${item.css}::${item.variant || ''}::${item.score || ''}`;
    if (!dedup.has(key)) dedup.set(key, item);
  }
  return Array.from(dedup.values());
}
