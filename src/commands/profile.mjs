import { listProfiles, createProfile, deleteProfile, setDefaultProfile, getDefaultProfile, loadConfig, saveConfig } from '../utils/config.mjs';

export async function handleProfileCommand(args) {
  const sub = args[1];
  const profileId = args[2];

  if (sub === 'list' || !sub) {
    const profiles = listProfiles();
    const defaultProfile = getDefaultProfile();
    console.log(JSON.stringify({ ok: true, profiles, defaultProfile, count: profiles.length }, null, 2));
    return;
  }

  if (sub === 'create') {
    if (!profileId) throw new Error('Usage: camo profile create <profileId>');
    createProfile(profileId);
    console.log(`Created profile: ${profileId}`);
    return;
  }

  if (sub === 'delete' || sub === 'remove') {
    if (!profileId) throw new Error('Usage: camo profile delete <profileId>');
    deleteProfile(profileId);
    const cfg = loadConfig();
    if (cfg.defaultProfile === profileId) {
      cfg.defaultProfile = null;
      saveConfig(cfg);
    }
    console.log(`Deleted profile: ${profileId}`);
    return;
  }

  if (sub === 'default') {
    if (!profileId) {
      console.log(JSON.stringify({ ok: true, defaultProfile: getDefaultProfile() }, null, 2));
      return;
    }
    const profiles = listProfiles();
    if (!profiles.includes(profileId)) throw new Error(`Profile not found: ${profileId}`);
    setDefaultProfile(profileId);
    console.log(`Default profile set to: ${profileId}`);
    return;
  }

  throw new Error('Usage: camo profile <list|create|delete|default> [profileId]');
}
