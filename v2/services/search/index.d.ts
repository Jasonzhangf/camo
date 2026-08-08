// Type declarations for @web-auto/camo/search.

export interface SearchResult {
  title: string;
  url: string;
  snippet?: string;
  author?: string;
  likes?: number;
  comments?: number;
  timestamp?: string;
  platform: string;
  raw?: unknown;
}

export interface SearchResponse {
  success: boolean;
  results: SearchResult[];
  totalCount: number;
  pageURL: string;
  error?: string;
}

export interface SearchOptions {
  platform: string;
  query: string;
  cookies?: string;
  profile?: string;
  timeout?: number;
  maxResults?: number;
  headless?: boolean;
}

export abstract class SearchPlatform {
  constructor(config?: Record<string, unknown>);
  readonly name: string;
  readonly searchURL: string;
  protected browser?: unknown;
  createBrowser(): Promise<unknown>;
  abstract search(query: string, options?: Partial<SearchOptions>): Promise<SearchResponse>;
  parseResults(): Promise<SearchResult[]>;
  cleanup(): Promise<void>;
  injectCookies(netscapeText: string): Promise<void>;
}

export class SearchEngine {
  registerPlatform(name: string, platform: new (config?: any) => SearchPlatform): void;
  getPlatform(name: string): (new (config?: any) => SearchPlatform) | undefined;
  search(options: SearchOptions): Promise<SearchResponse>;
  listPlatforms(): string[];
}

export class XHSSearch extends SearchPlatform {
  readonly name: string;
  readonly searchURL: string;
  search(query: string, options?: { maxResults?: number; timeout?: number; headless?: boolean }): Promise<SearchResponse>;
}

export class WeiboSearch extends SearchPlatform {
  readonly name: string;
  readonly searchURL: string;
  search(query: string, options?: { maxResults?: number; timeout?: number; headless?: boolean }): Promise<SearchResponse>;
}

export function getSearchEngine(): SearchEngine;
