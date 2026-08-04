// Browser Action Types - 对标 Openminis BrowserUseActions.swift
// Core actions for browser automation

export enum BrowserAction {
  Navigate = 'navigate',
  Screenshot = 'screenshot',
  Click = 'click',
  Type = 'type',
  GetText = 'get_text',
  Scroll = 'scroll',
  GetPageInfo = 'get_page_info',
  ExecuteJS = 'execute_js',
  FindElements = 'find_elements',
  Hover = 'hover',
  GetReadable = 'get_readable',
  SetUserAgent = 'set_user_agent',
  SetViewport = 'set_viewport',
  GetBackbone = 'get_backbone',
  Fetch = 'fetch',
  NewTab = 'new_tab',
  CloseTab = 'close_tab',
  ListTabs = 'list_tabs',
  GetCookies = 'get_cookies',
  SetCookies = 'set_cookies',
  ScrollAndCollect = 'scroll_and_collect',
  WaitForDomStable = 'wait_for_dom_stable',
}

export enum ScrollDirection {
  Up = 'up',
  Down = 'down',
}

export enum UserAgentProfile {
  MobileSafari = 'mobile_safari',
  DesktopSafari = 'desktop_safari',
  Custom = 'custom',
}

export interface BrowserActionInput {
  action: BrowserAction;
  url?: string;
  selector?: string;
  text?: string;
  coordinateX?: number;
  coordinateY?: number;
  direction?: ScrollDirection;
  amount?: number;
  script?: string;
  userAgent?: UserAgentProfile;
  maxDepth?: number;
  tabId?: number;
  scrollCount?: number;
  itemSelector?: string;
  keywords?: string[];
  fuzzy?: boolean;
  timeout?: number;
  viewportWidth?: number;
  viewportHeight?: number;
  viewportReset?: boolean;
  fullPage?: boolean;
  cookies?: CookieEntry[];
}

export interface CookieEntry {
  name: string;
  value: string;
  domain?: string;
  path?: string;
  secure?: boolean;
  httpOnly?: boolean;
  expires?: number;
}

export interface BrowserActionResult {
  text: string;
  success: boolean;
  base64Image?: string;
  imageFilePath?: string;
  pageURL?: string;
  tabId?: number;
  fetchedFileData?: Uint8Array;
  fetchedFileName?: string;
  fetchedBytes?: number;
  error?: string;
}

export function createSuccessResult(
  text: string,
  extras: Partial<BrowserActionResult> = {}
): BrowserActionResult {
  return { text, success: true, ...extras };
}

export function createErrorResult(error: string): BrowserActionResult {
  return { text: `Error: ${error}`, success: false };
}

// User Agent strings
export const UA_STRINGS: Record<UserAgentProfile, string> = {
  [UserAgentProfile.DesktopSafari]:
    'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Safari/605.1.15',
  [UserAgentProfile.MobileSafari]:
    'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
  [UserAgentProfile.Custom]: '',
};

export const VIEWPORT_SIZES: Record<UserAgentProfile, { width: number; height: number }> = {
  [UserAgentProfile.DesktopSafari]: { width: 1280, height: 800 },
  [UserAgentProfile.MobileSafari]: { width: 390, height: 844 },
  [UserAgentProfile.Custom]: { width: 390, height: 844 },
};

// Parse JSON input to BrowserActionInput
export function parseActionInput(json: string): BrowserActionInput | null {
  try {
    const data = JSON.parse(json);
    if (!data.action) return null;
    
    const action = data.action as BrowserAction;
    if (!Object.values(BrowserAction).includes(action)) return null;
    
    return {
      action,
      url: data.url,
      selector: data.selector,
      text: data.text,
      coordinateX: data.coordinate_x,
      coordinateY: data.coordinate_y,
      direction: data.direction ? (data.direction as ScrollDirection) : undefined,
      amount: data.amount,
      script: data.script,
      userAgent: data.user_agent ? (data.user_agent as UserAgentProfile) : undefined,
      maxDepth: data.max_depth,
      tabId: data.tab_id,
      scrollCount: data.scroll_count,
      itemSelector: data.item_selector,
      keywords: data.keywords,
      fuzzy: data.fuzzy,
      timeout: data.timeout,
      viewportWidth: data.viewport_width,
      viewportHeight: data.viewport_height,
      viewportReset: data.reset,
      fullPage: data.full_page,
      cookies: parseCookies(data.cookies),
    };
  } catch {
    return null;
  }
}

function parseCookies(raw: unknown): CookieEntry[] | undefined {
  if (!raw) return undefined;
  if (Array.isArray(raw)) return raw as CookieEntry[];
  if (typeof raw === 'string') {
    try {
      return JSON.parse(raw) as CookieEntry[];
    } catch {
      return undefined;
    }
  }
  return undefined;
}
