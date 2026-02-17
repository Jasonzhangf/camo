import { executeXhsAutoscriptOperation, isXhsAutoscriptAction } from './xhs.mjs';

export async function executeAutoscriptAction({ profileId, action, params = {} }) {
  if (isXhsAutoscriptAction(action)) {
    return executeXhsAutoscriptOperation({ profileId, action, params });
  }
  return null;
}

