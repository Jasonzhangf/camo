import { ensureCamoufox } from '../utils/browser-service.mjs';
import { listProfiles, getDefaultProfile } from '../utils/config.mjs';
import { downloadGeoIP, hasGeoIP, listAvailableRegions, listAvailableOS } from '../utils/fingerprint.mjs';

export async function handleInitCommand(args) {
  const subCmd = args[1];
  
  if (subCmd === 'geoip') {
    await handleInitGeoIP();
    return;
  }
  
  if (subCmd === 'list') {
    handleInitList();
    return;
  }
  
  // Default init: ensure camoufox + browser-service
  ensureCamoufox();
  const { ensureBrowserService } = await import('../utils/browser-service.mjs');
  await ensureBrowserService();
  
  const profiles = listProfiles();
  const defaultProfile = getDefaultProfile();
  const geoipReady = hasGeoIP();
  
  console.log(JSON.stringify({
    ok: true,
    profiles,
    defaultProfile,
    count: profiles.length,
    geoip: geoipReady,
    camoufox: true,
    browserService: true,
  }, null, 2));
}

async function handleInitGeoIP() {
  try {
    const path = await downloadGeoIP(console.log);
    console.log(JSON.stringify({
      ok: true,
      path,
      message: 'GeoIP database ready',
    }, null, 2));
  } catch (err) {
    console.error(`Error: ${err.message}`);
    process.exit(1);
  }
}

function handleInitList() {
  console.log('\n=== Available OS Options ===');
  const osList = listAvailableOS();
  osList.forEach(item => {
    console.log(`  ${item.key.padEnd(12)} - ${item.os} ${item.osVersion} (${item.platform})`);
  });
  
  console.log('\n=== Available Regions ===');
  const regions = listAvailableRegions();
  regions.forEach(item => {
    console.log(`  ${item.key.padEnd(12)} - ${item.country}, ${item.city} (${item.timezone})`);
  });
  
  console.log('\nUsage:');
  console.log('  camo create fingerprint --os mac --region us');
  console.log('  camo create fingerprint --os windows --region uk');
}
