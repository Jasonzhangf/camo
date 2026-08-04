// 资源监控 - 对标 Openminis BrowserTabPoolRegistry
// 全局资源状态跟踪和诊断

import { BrowserPoolRegistry } from '../resources/browser/BrowserPool.js';
import { TransientBrowserManager } from '../runtime/TransientBrowser.js';
import { PersistentBrowserManager } from '../runtime/PersistentBrowser.js';

export interface ResourceSnapshot {
  timestamp: number;
  globalTabs: number;
  globalTabCap: number;
  transientBrowsers: number;
  persistentBrowsers: number;
  pools: Array<{
    sessionId: string;
    tabCount: number;
    tabs: Array<{
      id: number;
      url: string;
      inUse: boolean;
      idleSeconds: number;
    }>;
  }>;
}

export interface LivenessProbe {
  tabId: number;
  hasURL: boolean;
  hasTitle: boolean;
}

export class ResourceMonitor {
  private static instance: ResourceMonitor;
  private registry = BrowserPoolRegistry.getInstance();
  private transientManager = TransientBrowserManager.getInstance();
  private persistentManager = PersistentBrowserManager.getInstance();
  private livenessProbes: Map<number, () => LivenessProbe | null> = new Map();
  private history: ResourceSnapshot[] = [];
  private maxHistory = 100;

  private constructor() {}

  static getInstance(): ResourceMonitor {
    if (!ResourceMonitor.instance) {
      ResourceMonitor.instance = new ResourceMonitor();
    }
    return ResourceMonitor.instance;
  }

  // 注册活跃探测
  registerLivenessProbe(tabId: number, probe: () => LivenessProbe | null): void {
    this.livenessProbes.set(tabId, probe);
  }

  // 取消注册
  unregisterLivenessProbe(tabId: number): void {
    this.livenessProbes.delete(tabId);
  }

  // 获取快照
  getSnapshot(): ResourceSnapshot {
    const poolSnapshots = this.registry.getAllSnapshots();
    
    return {
      timestamp: Date.now(),
      globalTabs: this.registry.totalLiveTabs(),
      globalTabCap: 8, // TODO: 从配置获取
      transientBrowsers: this.transientManager.list().length,
      persistentBrowsers: this.persistentManager.list().length,
      pools: poolSnapshots.map(pool => ({
        sessionId: pool.sessionId,
        tabCount: pool.tabCount,
        tabs: pool.tabs.map(tab => ({
          id: tab.id,
          url: tab.url,
          inUse: tab.inUse,
          idleSeconds: Math.floor(tab.lastActivityAgo / 1000),
        })),
      })),
    };
  }

  // 检查活跃性
  checkLiveness(tabId: number): LivenessProbe | null {
    const probe = this.livenessProbes.get(tabId);
    return probe ? probe() : null;
  }

  // 记录历史
  recordSnapshot(): void {
    const snapshot = this.getSnapshot();
    this.history.push(snapshot);
    if (this.history.length > this.maxHistory) {
      this.history.shift();
    }
  }

  // 获取历史
  getHistory(count = 10): ResourceSnapshot[] {
    return this.history.slice(-count);
  }

  // 获取诊断报告
  getDiagnosticReport(): string {
    const snapshot = this.getSnapshot();
    const lines: string[] = [
      '=== Resource Diagnostic Report ===',
      `Timestamp: ${new Date(snapshot.timestamp).toISOString()}`,
      '',
      'Global Resources:',
      `  Tabs: ${snapshot.globalTabs}/${snapshot.globalTabCap}`,
      `  Transient Browsers: ${snapshot.transientBrowsers}`,
      `  Persistent Browsers: ${snapshot.persistentBrowsers}`,
      '',
    ];
    
    if (snapshot.pools.length > 0) {
      lines.push('Pools:');
      for (const pool of snapshot.pools) {
        lines.push(`  ${pool.sessionId}:`);
        lines.push(`    Tabs: ${pool.tabCount}`);
        for (const tab of pool.tabs) {
          const status = tab.inUse ? 'in-use' : `idle ${tab.idleSeconds}s`;
          const urlShort = tab.url.length > 50 ? tab.url.slice(0, 50) + '...' : tab.url;
          lines.push(`      [${status}] ${urlShort}`);
        }
      }
    }
    
    return lines.join('\n');
  }

  // 处理内存警告
  handleMemoryWarning(): void {
    console.log('[ResourceMonitor] Handling memory warning...');
    this.registry.handleMemoryWarning();
    
    // 清理所有临时浏览器
    for (const { id } of this.transientManager.list()) {
      this.transientManager.destroy(id);
    }
    
    console.log('[ResourceMonitor] Memory warning handled');
  }

  // 健康检查
  isHealthy(): { healthy: boolean; issues: string[] } {
    const issues: string[] = [];
    const snapshot = this.getSnapshot();
    
    if (snapshot.globalTabs >= snapshot.globalTabCap) {
      issues.push('Global tab cap reached');
    }
    
    if (snapshot.transientBrowsers > 20) {
      issues.push(`High transient browser count: ${snapshot.transientBrowsers}`);
    }
    
    return {
      healthy: issues.length === 0,
      issues,
    };
  }
}

// 全局单例
export const resourceMonitor = ResourceMonitor.getInstance();
