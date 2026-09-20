// Browser-service facade over the session-owned target lifecycle.

import { CamoError } from '../../../contracts/error_envelope/projector.mjs';

export function createTargetFacade({ ensureWritable, safeId, getPage }) {
    async function resolveTarget({ target: targetId = null, profileId = null } = {}) {
        const manager = await import('../../session/manager.mjs');
        return targetId
            ? manager.resolveTarget(targetId, { profileId })
            : manager.resolveTargetForProfile(safeId(profileId, 'profileId'));
    }

    async function listTargets({ profileId = null } = {}) {
        const { listTargets: listOwnedTargets } = await import('../../session/manager.mjs');
        return listOwnedTargets({ profileId });
    }

    async function allocateTargetForProfile(profileId) {
        ensureWritable();
        const pid = safeId(profileId, 'profileId');
        const page = getPage(pid);
        if (!page) {
            throw new CamoError({ code: 'E_STATE_NOT_FOUND', details: { resource: 'page', profileId: pid } });
        }
        const { allocateTarget } = await import('../../session/manager.mjs');
        return allocateTarget(pid, page);
    }

    async function allocateTargetForPage(profileId, page) {
        ensureWritable();
        const pid = safeId(profileId, 'profileId');
        const { allocateTarget } = await import('../../session/manager.mjs');
        return allocateTarget(pid, page);
    }

    async function invalidateTarget(targetId) {
        ensureWritable();
        const { invalidateTarget: invalidateOwnedTarget } = await import('../../session/manager.mjs');
        return invalidateOwnedTarget(targetId);
    }

    return {
        resolveTarget,
        listTargets,
        allocateTargetForProfile,
        allocateTargetForPage,
        invalidateTarget,
    };
}
