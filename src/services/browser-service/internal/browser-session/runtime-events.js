import { getStateBus } from '../state-bus.js';
import { logDebug } from '../logging.js';
const stateBus = getStateBus();
export function createRuntimeEventManager(sessionId) {
    const observers = new Set();
    function addObserver(observer) {
        observers.add(observer);
        logDebug('browser-service', 'runtimeObserver:add', { sessionId, total: observers.size });
        return () => {
            observers.delete(observer);
            logDebug('browser-service', 'runtimeObserver:remove', { sessionId, total: observers.size });
        };
    }
    function emit(event) {
        const payload = {
            ts: Date.now(),
            sessionId,
            ...event,
        };
        logDebug('browser-service', 'runtimeEvent', {
            sessionId,
            type: event?.type || 'unknown',
            observers: observers.size,
        });
        observers.forEach((observer) => {
            try {
                observer(payload);
            }
            catch (err) {
                console.warn('[BrowserSession] runtime observer error', err);
            }
        });
        publishState(payload);
    }
    function publishState(payload) {
        try {
            stateBus.setState(`browser-session:${sessionId}`, {
                status: 'running',
                lastRuntimeEvent: payload?.type || 'unknown',
                lastUrl: payload?.pageUrl || '',
                lastUpdate: payload?.ts || Date.now(),
            });
            stateBus.publish('browser.runtime.event', payload);
        }
        catch (err) {
            logDebug('browser-service', 'runtimeEvent:stateBus:error', {
                sessionId,
                error: err?.message || err,
            });
        }
    }
    function clearObservers() {
        observers.clear();
    }
    return {
        addObserver,
        emit,
        publishState,
        clearObservers,
    };
}
//# sourceMappingURL=runtime-events.js.map