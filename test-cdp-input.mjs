import http from 'node:http';

const PROFILE = 'xhs-qa-1';
const BASE_URL = 'http://127.0.0.1:7704';
let pass = 0, fail = 0;
function ok(n, d = '') { pass++; console.log('  OK ' + n + (d ? ' -- ' + d : '')); }
function bad(n, d = '') { fail++; console.log('  FAIL ' + n + (d ? ' -- ' + d : '')); }

async function callCamo(action, args = {}, timeoutMs = 10000) {
  const payload = JSON.stringify({ action, args });
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve({ ok: false, data: { error: 'timeout' } }), timeoutMs);
    const req = http.request(BASE_URL + '/command', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(payload) },
      timeout: timeoutMs,
    }, (res) => {
      let body = '';
      res.on('data', (c) => (body += c));
      res.on('end', () => { clearTimeout(timer); try { resolve({ ok: res.statusCode >= 200 && res.statusCode < 400, data: JSON.parse(body || '{}') }); } catch { resolve({ ok: false, data: { error: body } }); } });
    });
    req.on('error', (e) => { clearTimeout(timer); resolve({ ok: false, data: { error: e.message } }); });
    req.write(payload);
    req.end();
  });
}

async function checkHealth() {
  return new Promise((resolve) => {
    const req = http.get(BASE_URL + '/health', (res) => resolve(res.statusCode === 200));
    req.on('error', () => resolve(false));
    req.setTimeout(3000, () => { req.destroy(); resolve(false); });
  });
}

async function main() {
  console.log('=== CDP Input Mode Test (CAMO_INPUT_MODE=cdp) ===');
  console.log('Profile: ' + PROFILE);

  if (!(await checkHealth())) {
    console.log('FAIL camo service not running on :7704');
    process.exit(1);
  }
  ok('health check');

  // 1. evaluate
  const ev = await callCamo('evaluate', { profileId: PROFILE, script: '(() => 1 + 1)()' }, 5000);
  ev.ok && ev.data?.result === 2 ? ok('evaluate', 'result=2') : bad('evaluate', JSON.stringify(ev.data).slice(0, 60));

  // 2. screenshot
  const ss = await callCamo('screenshot', { profileId: PROFILE }, 8000);
  const b64 = String(ss.data?.data || ss.data?.result?.data || '');
  ss.ok && b64.length > 1000 ? ok('screenshot', Buffer.from(b64, 'base64').length + ' bytes') : bad('screenshot', JSON.stringify(ss.data).slice(0, 60));

  // 3. mouse:click CDP mode
  const t0 = Date.now();
  const click = await callCamo('mouse:click', { profileId: PROFILE, x: 100, y: 100, button: 'left', clicks: 1, delay: 50 }, 8000);
  const elapsed = Date.now() - t0;
  click.ok ? ok('mouse:click (CDP)', elapsed + 'ms') : bad('mouse:click (CDP)', JSON.stringify(click.data).slice(0, 80));

  // 4. keyboard:press
  const kp = await callCamo('keyboard:press', { profileId: PROFILE, key: 'Escape' }, 5000);
  kp.ok ? ok('keyboard:press') : bad('keyboard:press', JSON.stringify(kp.data).slice(0, 60));

  // 5. keyboard:type
  const kt = await callCamo('keyboard:type', { profileId: PROFILE, text: 'test', delay: 50 }, 5000);
  kt.ok ? ok('keyboard:type') : bad('keyboard:type', JSON.stringify(kt.data).slice(0, 60));

  // 6. mouse:wheel
  const wh = await callCamo('mouse:wheel', { profileId: PROFILE, deltaY: 300 }, 5000);
  wh.ok ? ok('mouse:wheel') : bad('mouse:wheel', JSON.stringify(wh.data).slice(0, 60));

  // 7. second mouse:click to verify stability
  const t1 = Date.now();
  const click2 = await callCamo('mouse:click', { profileId: PROFILE, x: 200, y: 200, button: 'left', clicks: 1, delay: 50 }, 8000);
  const elapsed2 = Date.now() - t1;
  click2.ok ? ok('mouse:click #2 (CDP)', elapsed2 + 'ms') : bad('mouse:click #2 (CDP)', JSON.stringify(click2.data).slice(0, 80));

  // 8. evaluate after clicks to verify page still responsive
  const ev2 = await callCamo('evaluate', { profileId: PROFILE, script: '(() => document.readyState)()' }, 5000);
  ev2.ok && ev2.data?.result === 'complete' ? ok('page state after CDP clicks', 'readyState=complete') : bad('page state after CDP clicks', JSON.stringify(ev2.data).slice(0, 60));

  console.log('\n=== Results: ' + pass + ' passed / ' + fail + ' failed ===');
  process.exit(fail > 0 ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
