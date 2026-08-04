// search builtin command. Module id=commands.builtins.search.
// Platform-agnostic search interface aligned with OpenMinis pattern.

import { getSearchEngine } from '../../../services/search/SearchEngine.mjs';
import { XHSSearch } from '../../../services/search/platforms/XHSSearch.mjs';
import { CamoError } from '../../../contracts/error_envelope/projector.mjs';
import fs from 'node:fs';
import path from 'node:path';

export const cmd = 'search';

export async function run(transport, parsed = {}, ctx = {}) {
  // Support both kebab and camel case profile
  const profile = parsed.profile || parsed.named?.profile || ctx.profile || 'default';
  
  // Extract positional args
  const platform = parsed.positional?.[0];
  const query = parsed.positional?.slice(1).join(' ') || parsed.named?.query || '';
  
  // Named options
  const cookieFile = parsed.named?.cookies;
  const maxResults = parsed.named?.['max-results'] || parsed.named?.maxResults || 20;
  
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
  
  let cookies;
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
    timeout: 60000,
  });
  
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
