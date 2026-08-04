import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const { Camoufox } = require('camoufox');

console.log('Testing Camoufox...');
Camoufox({ headless: true }).then(async (browser) => {
  console.log('Browser launched');
  
  // Test without viewport
  const ctx1 = await browser.newContext({});
  console.log('Context without viewport OK');
  const page1 = await ctx1.newPage();
  await page1.goto('https://example.com');
  console.log('Page loaded:', page1.url());
  await ctx1.close();
  
  await browser.close();
  console.log('Done!');
}).catch(e => console.log('Error:', e.message));
