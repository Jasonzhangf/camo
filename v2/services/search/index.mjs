// Search module barrel. Module id=services.search.
// 唯一真源入口：re-export 搜索抽象接口 + 平台实现。

export { SearchEngine, SearchPlatform, getSearchEngine } from './SearchEngine.mjs';
export { XHSSearch } from './platforms/XHSSearch.mjs';
export { WeiboSearch } from './platforms/WeiboSearch.mjs';
