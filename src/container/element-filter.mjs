// Container Element Filter - Filter DOM elements by visibility, container definitions

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
    if (selector.css && element.selector === selector.css) return true;
    if (selector.id && element.id === selector.id) return true;
    if (selector.classes) {
      const elementClasses = new Set(element.classes || []);
      if (selector.classes.every(c => elementClasses.has(c))) return true;
    }
    return false;
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
