import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Camoufox } = require('camoufox');

(async () => {
  console.log('Testing Camoufox...');
  
  const browser = await Camoufox({
    headless: true,
    viewport: null,
    screen: null,
  });
  
  console.log('Browser launched');
  const page = await browser.newPage();
  console.log('Page created');
  
  await page.goto('https://example.com');
  console.log('Page loaded:', await page.title());
  
  await browser.close();
  console.log('SUCCESS');
})().catch(e => console.error('ERROR:', e.message));
