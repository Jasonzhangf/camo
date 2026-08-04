// search builtin command. Module id=commands.builtins.search.
// Platform-agnostic search interface with login check.

import { getSearchEngine } from '../../../services/search/SearchEngine.mjs';
import { XHSSearch } from '../../../services/search/platforms/XHSSearch.mjs';
import { CamoError } from '../../../contracts/error_envelope/projector.mjs';
import fs from 'node:fs';
import path from 'node:path';

export const cmd = 'search';

export async function run(transport, parsed = {}, ctx = {}) {
  const profile = parsed.profile || parsed.named?.profile || ctx.profile || 'default';
  const platform = parsed.positional?.[0];
  const query = parsed.positional?.slice(1).join(' ') || parsed.named?.query || '';
  const cookieFile = parsed.named?.cookies;
  const maxResults = parsed.named?.['max-results'] || parsed.named?.maxResults || 20;
  const headless = parsed.named?.headless !== undefined ? parsed.named.headless : false;
  
  if (!platform) {
    throw new CamoError({
      code: 'E_INPUT_MISSING_FIELD',
      details: { field: 'platform' },
    });
  }
  
  if (!query) {
    throw new CamoError({
      code: 'E_INPUT_MISSING_FIELD',
      details: { field: 'query' },
    });
  }
  
  // 读取 Cookie 文件（如果有）
  let cookies = null;
  if (cookieFile) {
    const cookiePath = path.resolve(cookieFile);
    if (fs.existsSync(cookiePath)) {
      cookies = fs.readFileSync(cookiePath, 'utf8');
    }
  }
  
  const engine = getSearchEngine();
  engine.registerPlatform('xhs', XHSSearch);
  
  const result = await engine.search({
    platform,
    query,
    cookies,
    profile,
    maxResults,
    headless,  // 传递 headless 选项
    timeout: 60000,
  });
  
  // 处理登录错误
  if (result.error && result.error.includes('NOT_LOGGED_IN')) {
    return {
      cmd: 'search',
      searched: false,
      platform,
      query,
      success: false,
      totalCount: 0,
      results: [],
      error: result.error,
      requires_login: true,
      message: 'Please login using: camo login --platform ' + platform + ' --profile ' + profile,
    };
  }
  
  return {
    cmd: 'search',
    searched: true,
    platform,
    query,
    success: result.success,
    totalCount: result.totalCount,
    pageURL: result.pageURL,
    results: result.results,
    error: result.error,
  };
}
