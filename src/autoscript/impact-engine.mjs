export class ImpactEngine {
  constructor() {
    this.scriptStopped = false;
    this.blockedSubscriptions = new Set();
    this.blockedOperations = new Set();
  }

  isScriptStopped() {
    return this.scriptStopped;
  }

  isSubscriptionBlocked(subscriptionId) {
    if (!subscriptionId) return false;
    return this.blockedSubscriptions.has(subscriptionId);
  }

  isOperationBlocked(operationId) {
    if (!operationId) return false;
    return this.blockedOperations.has(operationId);
  }

  canRunOperation(operation, event) {
    if (this.scriptStopped) return false;
    if (this.isOperationBlocked(operation?.id)) return false;
    if (this.isSubscriptionBlocked(event?.subscriptionId)) return false;
    return true;
  }

  applyFailure({ operation, event }) {
    const opId = operation?.id || null;
    const subscriptionId = event?.subscriptionId || operation?.trigger?.subscriptionId || null;
    const onFailure = String(operation?.onFailure || '').trim().toLowerCase();
    const impact = String(operation?.impact || 'op').trim().toLowerCase();

    if (onFailure === 'continue') {
      return { scope: 'none', scriptStopped: false, blockedSubscriptions: [], blockedOperations: [] };
    }
    if (onFailure === 'stop_all') {
      this.scriptStopped = true;
      return { scope: 'script', scriptStopped: true, blockedSubscriptions: [], blockedOperations: [] };
    }

    if (impact === 'script') {
      this.scriptStopped = true;
      return { scope: 'script', scriptStopped: true, blockedSubscriptions: [], blockedOperations: [] };
    }

    if (impact === 'subscription') {
      if (subscriptionId) this.blockedSubscriptions.add(subscriptionId);
      return {
        scope: 'subscription',
        scriptStopped: false,
        blockedSubscriptions: subscriptionId ? [subscriptionId] : [],
        blockedOperations: [],
      };
    }

    if (onFailure === 'chain_stop') {
      if (subscriptionId) this.blockedSubscriptions.add(subscriptionId);
      else if (opId) this.blockedOperations.add(opId);
      return {
        scope: subscriptionId ? 'subscription' : 'op',
        scriptStopped: false,
        blockedSubscriptions: subscriptionId ? [subscriptionId] : [],
        blockedOperations: !subscriptionId && opId ? [opId] : [],
      };
    }

    if (opId) this.blockedOperations.add(opId);
    return {
      scope: 'op',
      scriptStopped: false,
      blockedSubscriptions: [],
      blockedOperations: opId ? [opId] : [],
    };
  }
}

