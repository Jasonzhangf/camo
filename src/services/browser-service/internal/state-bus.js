class LocalStateBus {
    state = new Map();
    subscribers = new Map();
    setState(key, payload) {
        this.state.set(key, { ...payload, lastUpdate: Date.now() });
        this.publish(`state:${key}`, this.state.get(key));
    }
    getState(key) {
        if (key)
            return this.state.get(key);
        return Object.fromEntries(this.state);
    }
    publish(event, payload) {
        const listeners = this.subscribers.get(event) || [];
        for (const listener of listeners) {
            try {
                listener(payload);
            }
            catch {
                // Keep runtime event pipeline resilient.
            }
        }
    }
    subscribe(event, listener) {
        const current = this.subscribers.get(event) || [];
        current.push(listener);
        this.subscribers.set(event, current);
        return () => {
            const next = (this.subscribers.get(event) || []).filter((fn) => fn !== listener);
            if (next.length === 0) {
                this.subscribers.delete(event);
            }
            else {
                this.subscribers.set(event, next);
            }
        };
    }
}
let stateBus = null;
export function getStateBus() {
    if (!stateBus)
        stateBus = new LocalStateBus();
    return stateBus;
}
export { LocalStateBus };
//# sourceMappingURL=state-bus.js.map