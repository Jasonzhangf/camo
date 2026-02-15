import { describe, it } from 'node:test';
import assert from 'node:assert';
import {
  GEOIP_REGIONS,
  OS_OPTIONS,
  hasGeoIP,
  getGeoIPPath,
  generateFingerprint,
  listAvailableRegions,
  listAvailableOS,
} from '../../../src/utils/fingerprint.mjs';

describe('fingerprint utilities', () => {
  describe('GEOIP_REGIONS', () => {
    it('should contain expected regions', () => {
      assert.ok(GEOIP_REGIONS['us']);
      assert.ok(GEOIP_REGIONS['uk']);
      assert.ok(GEOIP_REGIONS['jp']);
      assert.strictEqual(GEOIP_REGIONS['us'].country, 'United States');
    });

    it('should have required fields for each region', () => {
      for (const [key, config] of Object.entries(GEOIP_REGIONS)) {
        assert.ok(config.country, `${key} should have country`);
        assert.ok(config.timezone, `${key} should have timezone`);
        assert.ok(config.locale, `${key} should have locale`);
        assert.ok(config.city, `${key} should have city`);
      }
    });
  });

  describe('OS_OPTIONS', () => {
    it('should contain expected OS options', () => {
      assert.ok(OS_OPTIONS['mac']);
      assert.ok(OS_OPTIONS['windows']);
      assert.ok(OS_OPTIONS['linux']);
      assert.strictEqual(OS_OPTIONS['mac'].platform, 'darwin');
    });

    it('should have required fields for each OS', () => {
      for (const [key, config] of Object.entries(OS_OPTIONS)) {
        assert.ok(config.platform, `${key} should have platform`);
        assert.ok(config.os, `${key} should have os`);
        assert.ok(config.osVersion, `${key} should have osVersion`);
        assert.ok(config.cpuCores, `${key} should have cpuCores`);
        assert.ok(config.memory, `${key} should have memory`);
      }
    });
  });

  describe('hasGeoIP', () => {
    it('should return boolean', () => {
      const result = hasGeoIP();
      assert.strictEqual(typeof result, 'boolean');
    });
  });

  describe('getGeoIPPath', () => {
    it('should return a string path', () => {
      const path = getGeoIPPath();
      assert.strictEqual(typeof path, 'string');
      assert.ok(path.includes('geoip'));
    });
  });

  describe('generateFingerprint', () => {
    it('should generate fingerprint with default options', () => {
      const fp = generateFingerprint();
      assert.ok(fp.os);
      assert.ok(fp.platform);
      assert.ok(fp.screen);
      assert.ok(fp.webgl);
      assert.ok(fp.userAgent);
      assert.ok(fp.timezone);
    });

    it('should use specified OS', () => {
      const fp = generateFingerprint({ os: 'windows' });
      assert.strictEqual(fp.platform, 'win32');
      assert.strictEqual(fp.os, 'Windows');
    });

    it('should use specified region', () => {
      const fp = generateFingerprint({ region: 'jp' });
      assert.strictEqual(fp.country, 'Japan');
      assert.strictEqual(fp.timezone, 'Asia/Tokyo');
      assert.strictEqual(fp.locale, 'ja-JP');
    });

    it('should have valid screen dimensions', () => {
      const fp = generateFingerprint();
      assert.ok(fp.screen.width > 0);
      assert.ok(fp.screen.height > 0);
    });

    it('should have webgl vendor and renderer', () => {
      const fp = generateFingerprint();
      assert.ok(fp.webgl.vendor);
      assert.ok(fp.webgl.renderer);
    });

    it('should generate valid user agent for mac', () => {
      const fp = generateFingerprint({ os: 'mac' });
      assert.ok(fp.userAgent.includes('Macintosh'));
      assert.ok(fp.userAgent.includes('Chrome'));
    });

    it('should generate valid user agent for windows', () => {
      const fp = generateFingerprint({ os: 'windows' });
      assert.ok(fp.userAgent.includes('Windows'));
      assert.ok(fp.userAgent.includes('Chrome'));
    });

    it('should generate valid user agent for linux', () => {
      const fp = generateFingerprint({ os: 'linux' });
      assert.ok(fp.userAgent.includes('Linux'));
      assert.ok(fp.userAgent.includes('Chrome'));
    });

    it('should fallback to defaults for invalid os', () => {
      const fp = generateFingerprint({ os: 'invalid' });
      assert.ok(fp.os);
    });

    it('should fallback to defaults for invalid region', () => {
      const fp = generateFingerprint({ region: 'invalid' });
      assert.ok(fp.country);
    });
  });

  describe('listAvailableRegions', () => {
    it('should return array of regions', () => {
      const regions = listAvailableRegions();
      assert.ok(Array.isArray(regions));
      assert.ok(regions.length > 0);
    });

    it('should have required fields in each region', () => {
      const regions = listAvailableRegions();
      for (const r of regions) {
        assert.ok(r.key);
        assert.ok(r.country);
        assert.ok(r.city);
        assert.ok(r.timezone);
      }
    });
  });

  describe('listAvailableOS', () => {
    it('should return array of OS options', () => {
      const osList = listAvailableOS();
      assert.ok(Array.isArray(osList));
      assert.ok(osList.length > 0);
    });

    it('should have required fields in each OS', () => {
      const osList = listAvailableOS();
      for (const o of osList) {
        assert.ok(o.key);
        assert.ok(o.platform);
        assert.ok(o.os);
        assert.ok(o.osVersion);
      }
    });
  });
});
