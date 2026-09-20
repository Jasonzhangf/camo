// Read-only status projection for the daemon command surface.

export async function projectStatus({ args = {}, opts = {} } = {}) {
  const { listReclamation, listSessionDetails, listTargets } = await import('../../services/browser_service/bootstrap.mjs');
  const { status: pipelineStatus } = await import('../../services/page_runtime/input_pipeline.mjs');
  const sessions = await listSessionDetails();
  const allTargets = await listTargets();
  const requestedProfile = args?.profile || null;
  const requestedTarget = args?.target || null;
  const targets = allTargets
    .filter((target) => !requestedProfile || target.profileId === requestedProfile)
    .filter((target) => !requestedTarget || target.targetId === requestedTarget)
    .map((target) => ({
      target: target.targetId,
      profile: target.profileId,
      session: target.sessionId,
      generation: target.generation,
      page: target.pageId,
      status: target.status,
      createdAt: target.createdAt,
      updatedAt: target.updatedAt,
    }));
  const profiles = sessions
    .filter((record) => !requestedProfile || record.profileId === requestedProfile)
    .map((record) => ({
      profile: record.profileId,
      session: record.instanceId,
      generation: record.generation,
      status: record.status,
      startedAt: record.startedAt,
      updatedAt: record.updatedAt,
    }));
  const execution = profiles.map((record) => ({
    profile: record.profile,
    ...pipelineStatus(record.profile),
    outcome: pipelineStatus(record.profile).lastError
      ? 'failed'
      : (pipelineStatus(record.profile).running ? 'running' : 'unknown'),
  }));
  return {
    ok: true,
    service: {
      state: 'available',
      daemonId: opts.daemonId,
      mode: opts.mode,
    },
    profiles,
    targets,
    execution,
    reclamation: await listReclamation(),
    errors: [],
  };
}
