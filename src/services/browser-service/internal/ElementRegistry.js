/**
 * 元素注册表
 * 管理浏览器端 ElementHandle 的生命周期和映射
 */
export class ElementRegistry {
    elements = new Map();
    pageMap = new Map(); // elementId -> pageId (for cleanup)
    /**
     * 注册元素并返回唯一 ID
     */
    register(element, pageId) {
        const id = `el_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        this.elements.set(id, element);
        if (pageId) {
            this.pageMap.set(id, pageId);
        }
        return id;
    }
    /**
     * 获取元素
     */
    get(id) {
        return this.elements.get(id);
    }
    /**
     * 释放元素
     */
    async release(id) {
        const element = this.elements.get(id);
        if (element) {
            try {
                await element.dispose();
            }
            catch (e) {
                // Ignore disposal errors
            }
            this.elements.delete(id);
            this.pageMap.delete(id);
        }
    }
    /**
     * 清理特定页面的所有元素
     */
    async clearPage(pageId) {
        const toRemove = [];
        for (const [id, pid] of this.pageMap.entries()) {
            if (pid === pageId) {
                toRemove.push(id);
            }
        }
        await Promise.all(toRemove.map(id => this.release(id)));
    }
    /**
     * 清理所有元素
     */
    async clearAll() {
        const ids = Array.from(this.elements.keys());
        await Promise.all(ids.map(id => this.release(id)));
    }
}
//# sourceMappingURL=ElementRegistry.js.map