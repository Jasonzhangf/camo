/**
 * Browser actions module - Playwright-based page operations
 * No external browser-service dependency
 */
import { getActiveBrowser, getCurrentPage, isBrowserRunning } from './browser.mjs';

/**
 * Navigate to URL
 */
export async function navigateTo(profileId, url) {
  if (!isBrowserRunning(profileId)) {
    throw new Error(`No browser running for profile: ${profileId}`);
  }

  const page = await getCurrentPage(profileId);
  await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 30000 });

  return {
    ok: true,
    profileId,
    url: page.url(),
    title: await page.title(),
  };
}

/**
 * Go back
 */
export async function goBack(profileId) {
  if (!isBrowserRunning(profileId)) {
    throw new Error(`No browser running for profile: ${profileId}`);
  }

  const page = await getCurrentPage(profileId);
  await page.goBack({ waitUntil: 'domcontentloaded' });

  return {
    ok: true,
    profileId,
    url: page.url(),
  };
}

/**
 * Take screenshot
 */
export async function takeScreenshot(profileId, options = {}) {
  if (!isBrowserRunning(profileId)) {
    throw new Error(`No browser running for profile: ${profileId}`);
  }

  const page = await getCurrentPage(profileId);
  const buffer = await page.screenshot({
    fullPage: options.fullPage || false,
    type: 'png',
  });

  return {
    ok: true,
    profileId,
    data: buffer.toString('base64'),
    width: options.fullPage ? undefined : page.viewportSize()?.width,
    height: options.fullPage ? undefined : page.viewportSize()?.height,
  };
}

/**
 * Scroll page
 */
export async function scrollPage(profileId, options = {}) {
  if (!isBrowserRunning(profileId)) {
    throw new Error(`No browser running for profile: ${profileId}`);
  }

  const page = await getCurrentPage(profileId);
  const direction = options.direction || 'down';
  const amount = options.amount || 300;

  const deltaX = direction === 'left' ? -amount : direction === 'right' ? amount : 0;
  const deltaY = direction === 'up' ? -amount : direction === 'down' ? amount : 0;

  await page.mouse.wheel(deltaX, deltaY);

  return {
    ok: true,
    profileId,
    direction,
    amount,
  scrolled: true,
  };
}

/**
 * Click element
 */
export async function clickElement(profileId, selector, options = {}) {
  if (!isBrowserRunning(profileId)) {
    throw new Error(`No browser running for profile: ${profileId}`);
  }

  const page = await getCurrentPage(profileId);

  // Wait for element to be visible
  await page.waitForSelector(selector, { state: 'visible', timeout: options.timeout || 10000 });

  // Scroll into view if needed
  await page.locator(selector).scrollIntoViewIfNeeded();

  // Click with system-level mouse
  const element = await page.$(selector);
  const box = await element.boundingBox();

  if (!box) {
    throw new Error(`Element not visible: ${selector}`);
  }

  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;

  await page.mouse.move(x, y);
  await page.mouse.click(x, y, { button: options.button || 'left', clickCount: options.clickCount || 1 });

  return {
    ok: true,
    profileId,
    selector,
    clicked: true,
    position: { x, y },
  };
}

/**
 * Type text
 */
export async function typeText(profileId, selector, text, options = {}) {
  if (!isBrowserRunning(profileId)) {
    throw new Error(`No browser running for profile: ${profileId}`);
  }

  const page = await getCurrentPage(profileId);

  // Wait for element to be visible
  await page.waitForSelector(selector, { state: 'visible', timeout: options.timeout || 10000 });

  // Scroll into view if needed
  await page.locator(selector).scrollIntoViewIfNeeded();

  // Focus and type
  const element = await page.$(selector);
  await element.focus();
  await element.fill('');

  if (options.slowly) {
    await element.type(text, { delay: 50 });
  } else {
    await element.fill(text);
  }

  if (options.pressEnter) {
    await page.keyboard.press('Enter');
  }

  return {
    ok: true,
    profileId,
    selector,
    typed: text.length,
  };
}

/**
 * Press key
 */
export async function pressKey(profileId, key) {
  if (!isBrowserRunning(profileId)) {
    throw new Error(`No browser running for profile: ${profileId}`);
  }

  const page = await getCurrentPage(profileId);
  await page.keyboard.press(key);

  return {
    ok: true,
    profileId,
    key,
  };
}

/**
 * Highlight element
 */
export async function highlightElement(profileId, selector, options = {}) {
  if (!isBrowserRunning(profileId)) {
    throw new Error(`No browser running for profile: ${profileId}`);
  }

  const page = await getCurrentPage(profileId);

  const result = await page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;

    const prev = el.style.outline;
    el.style.outline = '3px solid #ff4444';

    const rect = el.getBoundingClientRect();
    return {
      highlighted: true,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      prevOutline: prev,
    };
  }, selector);

  if (!result) {
    throw new Error(`Element not found: ${selector}`);
  }

  // Auto-clear highlight after duration
  const duration = options.duration || 2000;
  setTimeout(async () => {
    try {
      const currentPage = await getCurrentPage(profileId);
      await currentPage.evaluate((sel) => {
        const el = document.querySelector(sel);
        if (el) el.style.outline = '';
      }, selector);
    } catch {
      // Browser may have been closed
    }
  }, duration);

  return {
    ok: true,
    profileId,
    selector,
    ...result,
  };
}

/**
 * Clear all highlights
 */
export async function clearHighlights(profileId) {
  if (!isBrowserRunning(profileId)) {
    throw new Error(`No browser running for profile: ${profileId}`);
  }

  const page = await getCurrentPage(profileId);
  await page.evaluate(() => {
    document.querySelectorAll('[style*="outline"]').forEach((el) => {
      el.style.outline = '';
    });
  });

  return {
    ok: true,
    profileId,
    cleared: true,
  };
}

/**
 * Set viewport size
 */
export async function setViewport(profileId, width, height) {
  if (!isBrowserRunning(profileId)) {
    throw new Error(`No browser running for profile: ${profileId}`);
  }

  const page = await getCurrentPage(profileId);
  await page.setViewportSize({ width, height });

  return {
    ok: true,
    profileId,
    viewport: { width, height },
  };
}

/**
 * Get page info (URL, title, etc)
 */
export async function getPageInfo(profileId) {
  if (!isBrowserRunning(profileId)) {
    throw new Error(`No browser running for profile: ${profileId}`);
  }

  const page = await getCurrentPage(profileId);

  return {
    ok: true,
    profileId,
    url: page.url(),
    title: await page.title(),
    viewport: page.viewportSize(),
  };
}

/**
 * Get DOM snapshot
 */
export async function getDOMSnapshot(profileId, options = {}) {
  if (!isBrowserRunning(profileId)) {
    throw new Error(`No browser running for profile: ${profileId}`);
  }

  const page = await getCurrentPage(profileId);

  const snapshot = await page.evaluate((opts) => {
    const collectNodes = (node, depth = 0, path = 'root') => {
      if (depth > 10) return null;
      if (!node) return null;

      const result = {
        tag: node.tagName?.toLowerCase() || node.nodeName?.toLowerCase(),
        id: node.id || null,
        classes: node.className ? node.className.split(' ').filter(Boolean) : [],
        path,
      };

      const rect = node.getBoundingClientRect?.() || null;
      if (rect) {
        result.rect = { x: rect.x, y: rect.y, width: rect.width, height: rect.height };
      }

      const text = node.textContent?.trim().slice(0, 50) || '';
      if (text && node.children?.length === 0) {
        result.text = text;
      }

      if (node.children && node.children.length > 0) {
        result.children = [];
        for (let i = 0; i < node.children.length; i++) {
          const child = collectNodes(node.children[i], depth + 1, `${path}/${i}`);
          if (child) result.children.push(child);
        }
      }

      return result;
    };

    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const root = collectNodes(document.body, 0, 'root');

    return { viewport, dom_tree: root };
  }, options);

  return {
    ok: true,
    profileId,
    ...snapshot,
  };
}

/**
 * Query elements
 */
export async function queryElements(profileId, selector, options = {}) {
  if (!isBrowserRunning(profileId)) {
    throw new Error(`No browser running for profile: ${profileId}`);
  }

  const page = await getCurrentPage(profileId);

  const elements = await page.evaluate((sel) => {
    const nodes = document.querySelectorAll(sel);
    return Array.from(nodes).map((el, idx) => {
      const rect = el.getBoundingClientRect();
      return {
        index: idx,
        tag: el.tagName.toLowerCase(),
        id: el.id || null,
        classes: el.className.split(' ').filter(Boolean),
        text: el.textContent?.trim().slice(0, 100) || '',
        rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
        visible: rect.width > 0 && rect.height > 0,
      };
    });
  }, selector);

  return {
    ok: true,
    profileId,
    selector,
    count: elements.length,
    elements,
  };
}

/**
 * Execute JavaScript
 */
export async function evaluateJS(profileId, script) {
  if (!isBrowserRunning(profileId)) {
    throw new Error(`No browser running for profile: ${profileId}`);
  }

  const page = await getCurrentPage(profileId);
  const result = await page.evaluate(script);

  return {
    ok: true,
    profileId,
    result,
  };
}

/**
 * Create new page
 */
export async function createNewPage(profileId, options = {}) {
  const browser = getActiveBrowser(profileId);
  if (!browser) {
    throw new Error(`No browser running for profile: ${profileId}`);
  }

  const context = browser.pwBrowser?.contexts()[0];
  if (!context) {
    throw new Error('No browser context available');
  }

  const page = await context.newPage();
  if (options.url) {
    await page.goto(options.url, { waitUntil: 'domcontentloaded' });
  }

  browser.pages.push(page);
  browser.currentPage = page;

  return {
    ok: true,
    profileId,
    pageIndex: browser.pages.length - 1,
    url: options.url || 'about:blank',
  };
}

/**
 * List pages
 */
export async function listPages(profileId) {
  const browser = getActiveBrowser(profileId);
  if (!browser) {
    throw new Error(`No browser running for profile: ${profileId}`);
  }

  const context = browser.pwBrowser?.contexts()[0];
  if (!context) {
    throw new Error('No browser context available');
  }

  const pages = context.pages();
  const pageInfos = await Promise.all(pages.map(async (page, idx) => ({
    index: idx,
    url: page.url(),
    title: await page.title().catch(() => ''),
  })));

  return {
    ok: true,
    profileId,
    count: pageInfos.length,
    pages: pageInfos,
  currentPage: browser.currentPage?._guid || 0,
  };
}

/**
 * Switch page
 */
export async function switchPage(profileId, pageIndex) {
  const browser = getActiveBrowser(profileId);
  if (!browser) {
    throw new Error(`No browser running for profile: ${profileId}`);
  }

  const context = browser.pwBrowser?.contexts()[0];
  if (!context) {
    throw new Error('No browser context available');
  }

  const pages = context.pages();
  if (pageIndex < 0 || pageIndex >= pages.length) {
    throw new Error(`Invalid page index: ${pageIndex}`);
  }

  browser.currentPage = pages[pageIndex];
  await pages[pageIndex].bringToFront();

  return {
    ok: true,
    profileId,
    pageIndex,
    url: pages[pageIndex].url(),
  };
}

/**
 * Close page
 */
export async function closePage(profileId, pageIndex) {
  const browser = getActiveBrowser(profileId);
  if (!browser) {
    throw new Error(`No browser running for profile: ${profileId}`);
  }

  const context = browser.pwBrowser?.contexts()[0];
  if (!context) {
    throw new Error('No browser context available');
  }

  const pages = context.pages();
  const idx = pageIndex !== undefined ? pageIndex : pages.length - 1;

  if (idx < 0 || idx >= pages.length) {
    throw new Error(`Invalid page index: ${idx}`);
  }

  await pages[idx].close();
  browser.pages = pages.filter((_, i) => i !== idx);

  // Update current page if needed
  if (browser.currentPage === pages[idx]) {
    browser.currentPage = browser.pages[0] || null;
  }

  return {
    ok: true,
    profileId,
    closedIndex: idx,
    remaining: browser.pages.length,
  };
}

/**
 * Mouse operations
 */
export async function mouseMove(profileId, x, y, options = {}) {
  if (!isBrowserRunning(profileId)) {
    throw new Error(`No browser running for profile: ${profileId}`);
  }

  const page = await getCurrentPage(profileId);
  await page.mouse.move(x, y, { steps: options.steps || 1 });

  return { ok: true, profileId, x, y };
}

export async function mouseClick(profileId, x, y, options = {}) {
  if (!isBrowserRunning(profileId)) {
    throw new Error(`No browser running for profile: ${profileId}`);
  }

  const page = await getCurrentPage(profileId);
  await page.mouse.click(x, y, {
    button: options.button || 'left',
    clickCount: options.clickCount || 1,
    delay: options.delay || 0,
  });

  return { ok: true, profileId, x, y, button: options.button || 'left' };
}

export async function mouseWheel(profileId, deltaX, deltaY) {
  if (!isBrowserRunning(profileId)) {
    throw new Error(`No browser running for profile: ${profileId}`);
  }

  const page = await getCurrentPage(profileId);
  await page.mouse.wheel(deltaX, deltaY);

  return { ok: true, profileId, deltaX, deltaY };
}
