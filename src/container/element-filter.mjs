// Container Element Filter - Filter DOM elements by visibility, container definitions

function parseCssSelector(css) {
  const raw = typeof css === 'string' ? css.trim() : '';
  if (!raw) return [];
  return raw
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean)
    .map((item) => {
      const tagMatch = item.match(/^[a-zA-Z][\w-]*/);
      const idMatch = item.match(/#([\w-]+)/);
      const classMatches = item.match(/\.([\w-]+)/g) || [];
      return {
        tag: tagMatch ? tagMatch[0].toLowerCase() : null,
        id: idMatch ? idMatch[1] : null,
        classes: classMatches.map((token) => token.slice(1)),
      };
    });
}

export class ElementFilter {
  constructor(options = {}) {
    this.viewportMargin = options.viewportMargin || 0;
    this.minVisibleRatio = options.minVisibleRatio || 0.5;
  }

  // Check if element is in viewport
  isInViewport(rect, viewport) {
    return (
      rect.left < viewport.width + this.viewportMargin &&
      rect.right > -this.viewportMargin &&
      rect.top < viewport.height + this.viewportMargin &&
      rect.bottom > -this.viewportMargin
    );
  }

  // Calculate visibility ratio
  getVisibilityRatio(rect, viewport) {
    const visibleLeft = Math.max(0, rect.left);
    const visibleTop = Math.max(0, rect.top);
    const visibleRight = Math.min(viewport.width, rect.right);
    const visibleBottom = Math.min(viewport.height, rect.bottom);

    const visibleArea = Math.max(0, visibleRight - visibleLeft) * Math.max(0, visibleBottom - visibleTop);
    const totalArea = rect.width * rect.height;

    return totalArea > 0 ? visibleArea / totalArea : 0;
  }

  // Filter elements by container definition
  filterByContainer(elements, containerDef) {
    const selectors = containerDef.selectors || [];
    const results = [];

    for (const element of elements) {
      for (const selector of selectors) {
        if (this.matchesSelector(element, selector)) {
          results.push({
            element,
            container: containerDef,
            matchedSelector: selector,
          });
          break;
        }
      }
    }

    return results;
  }

  // Check if element matches selector definition
  matchesSelector(element, selector) {
    if (!element || !selector) return false;
    if (selector.css && element.selector === selector.css) return true;

    const elementTag = typeof element.tag === 'string' ? element.tag.toLowerCase() : null;
    const elementId = typeof element.id === 'string' ? element.id : null;
    const elementClasses = new Set(Array.isArray(element.classes) ? element.classes : []);

    const cssVariants = parseCssSelector(selector.css);
    if (cssVariants.length > 0) {
      for (const cssVariant of cssVariants) {
        let matched = true;
        if (cssVariant.tag && elementTag !== cssVariant.tag) matched = false;
        if (cssVariant.id && elementId !== cssVariant.id) matched = false;
        if (matched && cssVariant.classes.length > 0) {
          matched = cssVariant.classes.every((className) => elementClasses.has(className));
        }
        if (matched) return true;
      }
    }

    const requiredTag = selector.tag ? String(selector.tag).toLowerCase() : null;
    const requiredId = selector.id ? String(selector.id) : null;
    const requiredClasses = Array.isArray(selector.classes)
      ? selector.classes.filter(Boolean).map((className) => String(className))
      : [];

    const hasStructuredSelector = Boolean(requiredTag || requiredId || requiredClasses.length > 0);
    if (!hasStructuredSelector) return false;
    if (requiredTag && elementTag !== requiredTag) return false;
    if (requiredId && elementId !== requiredId) return false;
    if (requiredClasses.length > 0 && !requiredClasses.every((className) => elementClasses.has(className))) {
      return false;
    }
    return true;
  }

  // Main filter method
  filter(elements, options = {}) {
    const {
      container,
      viewport,
      requireVisible = true,
      minVisibleRatio = this.minVisibleRatio,
    } = options;

    let results = [...elements];

    // Filter by container definition
    if (container) {
      results = this.filterByContainer(results, container);
    }

    // Filter by viewport visibility
    if (requireVisible && viewport) {
      results = results.filter(item => {
        const rect = item.element?.rect || item.rect;
        if (!rect) return false;
        const ratio = this.getVisibilityRatio(rect, viewport);
        item.visibilityRatio = ratio;
        return ratio >= minVisibleRatio;
      });
    }

    return results;
  }
}

export function createElementFilter(options) {
  return new ElementFilter(options);
}
