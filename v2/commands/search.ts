// Search CLI Command - 搜索能力暴露
import { getSearchEngine } from '../services/search/SearchEngine.js';
import { XHSSearch } from '../services/search/platforms/XHSSearch.js';
import { PersistentBrowserManager } from '../runtime/PersistentBrowser.js';

export async function searchCommand(args: {
  platform: string;
  query: string;
  cookies?: string;
  profile?: string;
  maxResults?: number;
}): Promise<void> {
  const engine = getSearchEngine();
  
  // 注册 XHS 平台
  engine.registerPlatform('xhs', XHSSearch as any);
  
  console.log(`[camo search] platform=${args.platform} query="${args.query}"`);
  
  const response = await engine.search({
    platform: args.platform,
    query: args.query,
    cookies: args.cookies,
    profile: args.profile,
    maxResults: args.maxResults,
  });
  
  if (!response.success) {
    console.error(`[camo search] Error: ${response.error}`);
    process.exit(1);
  }
  
  console.log(`[camo search] Found ${response.totalCount} results`);
  console.log(`[camo search] Page: ${response.pageURL}`);
  console.log('');
  
  for (let i = 0; i < response.results.length; i++) {
    const r = response.results[i];
    console.log(`${i + 1}. ${r.title}`);
    console.log(`   URL: ${r.url}`);
    if (r.author) console.log(`   Author: ${r.author}`);
    if (r.likes) console.log(`   Likes: ${r.likes}`);
    console.log('');
  }
}

export async function profileCommand(args: {
  action: 'list' | 'cookies' | 'start' | 'stop';
  profile?: string;
  cookieFile?: string;
}): Promise<void> {
  const manager = PersistentBrowserManager.getInstance();
  
  switch (args.action) {
    case 'list':
      const list = manager.list();
      console.log('Persistent Browsers:');
      for (const { profile, status } of list) {
        console.log(`  ${profile}: ${status.running ? 'running' : 'stopped'}`);
        if (status.running) {
          console.log(`    Cookies: ${status.cookies}`);
        }
      }
      break;
      
    case 'start':
      if (!args.profile) {
        console.error('[camo profile] Error: --profile required');
        process.exit(1);
      }
      const browser = await manager.getOrCreate(args.profile);
      console.log(`[camo profile] Started ${args.profile}`);
      break;
      
    case 'stop':
      if (!args.profile) {
        console.error('[camo profile] Error: --profile required');
        process.exit(1);
      }
      await manager.stop(args.profile);
      console.log(`[camo profile] Stopped ${args.profile}`);
      break;
      
    case 'cookies':
      if (!args.profile) {
        console.error('[camo profile] Error: --profile required');
        process.exit(1);
      }
      const pb = manager.get(args.profile);
      if (!pb) {
        console.error(`[camo profile] Profile ${args.profile} not found`);
        process.exit(1);
      }
      if (args.cookieFile) {
        const text = require('fs').readFileSync(args.cookieFile, 'utf8');
        await pb.injectCookies(text);
        console.log(`[camo profile] Imported cookies from ${args.cookieFile}`);
      } else {
        const text = await pb.exportCookies();
        console.log(text);
      }
      break;
  }
}

export async function browserListCommand(): Promise<void> {
  const { resourceMonitor } = await import('../monitoring/ResourceMonitor.js');
  const report = resourceMonitor.getDiagnosticReport();
  console.log(report);
}
