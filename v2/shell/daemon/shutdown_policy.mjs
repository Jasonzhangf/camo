export async function shutdownDaemonResources({
  shutdownBrowsers,
  clearBrowserTruth,
  releaseRegistration,
  closeServers,
}) {
  try {
    await shutdownBrowsers();
  } catch (cause) {
    return { ok: false, stage: 'browser_service', cause };
  }

  clearBrowserTruth();

  try {
    await closeServers();
  } catch (cause) {
    return { ok: false, stage: 'servers', cause };
  }

  try {
    await releaseRegistration();
  } catch (cause) {
    return { ok: false, stage: 'registration', cause };
  }

  return { ok: true };
}
