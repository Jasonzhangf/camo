import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { firefox } = require('playwright-core');
const { getLaunchPath } = require('camoufox');

(async () => {
  const browser = await firefox.launch({ headless: true, executablePath: getLaunchPath() });
  const context = await browser.newContext({
    userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
  });
  
  const page = await context.newPage();
  console.log('Navigating to xiaohongshu...');
  await page.goto('https://www.xiaohongshu.com/search_result?keyword=%E5%92%96%E5%95%A1', { timeout: 30000 });
  await page.waitForTimeout(5000);
  
  const result = await page.evaluate(() => {
    return {
      title: document.title,
      url: window.location.href,
      resultCount: document.querySelectorAll('[class*="note"], [class*="item"], [class*="discovery"]').length,
      bodyText: document.body?.innerText?.slice(0, 500) || '',
      html: document.body?.innerHTML?.slice(0, 2000) || '',
    };
  });
  
  console.log('Result:', JSON.stringify(result, null, 2));
  await browser.close();
})().catch(e => console.error('ERROR:', e.message));
