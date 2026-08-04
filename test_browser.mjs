import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { firefox } = require('playwright-core');
const { getLaunchPath } = require('camoufox');

(async () => {
  const executablePath = getLaunchPath();
  console.log('Firefox path:', executablePath);
  
  const browser = await firefox.launch({ headless: true, executablePath });
  const page = await browser.newPage();
  
  await page.goto('https://example.com');
  console.log('Page URL:', page.url());
  console.log('Page title:', await page.title());
  
  // 测试 JS 执行
  const result = await page.evaluate(() => {
    return { title: document.title, bodyText: document.body?.textContent?.slice(0, 100) };
  });
  console.log('Evaluate result:', result);
  
  await browser.close();
  console.log('SUCCESS');
})().catch(e => console.error('ERROR:', e.message));
