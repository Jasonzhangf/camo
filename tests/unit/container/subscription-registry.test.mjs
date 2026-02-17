import { describe, it, beforeEach, afterEach } from 'node:test';
import assert from 'node:assert';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  getRegisteredTargets,
  initContainerSubscriptionDirectory,
  listSubscriptionSets,
  registerSubscriptionTargets,
} from '../../../src/container/subscription-registry.mjs';

function writeJson(filePath, data) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
}

describe('subscription registry', () => {
  let tmpRoot;
  let libraryRoot;
  let subscriptionRoot;
  let userContainerRoot;

  beforeEach(() => {
    tmpRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'camo-sub-reg-'));
    libraryRoot = path.join(tmpRoot, 'container-library');
    subscriptionRoot = path.join(tmpRoot, 'subscription-root');
    userContainerRoot = path.join(tmpRoot, 'container-lib');

    writeJson(path.join(libraryRoot, 'xiaohongshu', 'home', 'container.json'), {
      id: 'xiaohongshu_home',
      name: 'XHS Home',
      type: 'page',
      page_patterns: ['xiaohongshu.com/explore'],
      selectors: [
        { css: '.feeds-page', variant: 'primary', score: 1 },
        { css: '#search-input', variant: 'backup', score: 0.8 },
      ],
      children: ['xiaohongshu_home.feed_list'],
    });

    writeJson(path.join(libraryRoot, 'cbu', 'containers.json'), {
      website: '1688.com',
      containers: {
        'home.search': {
          selector: '.ali-search-box, #alisearch-input',
          page_url: 'https://www.1688.com',
        },
      },
    });
  });

  afterEach(() => {
    if (tmpRoot && fs.existsSync(tmpRoot)) {
      fs.rmSync(tmpRoot, { recursive: true, force: true });
    }
  });

  it('initializes subscription directory and migrates both tree and legacy formats', () => {
    const initResult = initContainerSubscriptionDirectory({
      containerLibraryRoot: libraryRoot,
      subscriptionRoot,
      userContainerRoot,
      force: true,
    });

    assert.strictEqual(initResult.ok, true);
    assert.ok(initResult.setCount >= 2);
    assert.strictEqual(initResult.userContainerRoot, userContainerRoot);
    assert.ok(fs.existsSync(path.join(subscriptionRoot, 'index.json')));

    const setsResult = listSubscriptionSets({ subscriptionRoot });
    const ids = setsResult.sets.map((set) => set.id);
    assert.ok(ids.includes('xiaohongshu_home'));
    assert.ok(ids.includes('home.search'));
  });

  it('registers targets with path and url_dom markers', () => {
    initContainerSubscriptionDirectory({
      containerLibraryRoot: libraryRoot,
      subscriptionRoot,
      userContainerRoot,
      force: true,
    });

    const registerResult = registerSubscriptionTargets('profile-a', ['xiaohongshu_home'], {
      subscriptionRoot,
    });
    assert.strictEqual(registerResult.ok, true);
    assert.ok(registerResult.targetCount >= 2);
    assert.ok(registerResult.selectorCount >= 1);

    const targetResult = getRegisteredTargets('profile-a', { subscriptionRoot });
    assert.strictEqual(targetResult.ok, true);
    assert.ok(targetResult.profile);
    assert.ok(Array.isArray(targetResult.profile.targets));
    assert.ok(targetResult.profile.targets.some((target) => target.markerType === 'path'));
    assert.ok(targetResult.profile.targets.some((target) => target.markerType === 'url_dom'));
  });
});
