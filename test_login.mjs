import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Camoufox } = require('/Users/fanzhang/Documents/github/camo/node_modules/camoufox/dist/index.cjs');

(async () => {
  const browser = await Camoufox({ headless: false, viewport: null });
  const page = await browser.newPage();
  
  // 检查主页
  await page.goto('https://www.xiaohongshu.com', { timeout: 30000 });
  await page.waitForTimeout(3000);
  
  const homeText = await page.evaluate(() => document.body?.innerText || '');
  console.log('Home page has 登录:', homeText.includes('登录后查看'));
  console.log('Home page has 扫码:', homeText.includes('扫码登录'));
  
  // 检查搜索页面
  await page.goto('https://www.xiaohongshu.com/search_result?keyword=%E5%92%96%E5%95%A1', { timeout: 30000 });
  await page.waitForTimeout(3000);
  
  const searchText = await page.evaluate(() => document.body?.innerText || '');
  console.log('\nSearch page has 登录:', searchText.includes('登录后查看'));
  console.log('Search page has 扫码:', searchText.includes('扫码登录'));
  console.log('Search page text sample:', searchText.slice(0, 500));
  
  await browser.close();
})().catch(e => console.error('ERROR:', e.message));
