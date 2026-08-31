import { spawn } from 'node:child_process';

export function spawnDaemonProcess({
  scriptPath,
  args = [],
  env = process.env,
  spawnImpl = spawn,
}) {
  const child = spawnImpl(process.execPath, [scriptPath, ...args], {
    stdio: 'ignore',
    detached: true,
    env: { ...env, CAMO_WS_PORT: '0', CAMO_HTTP_PORT: '0' },
  });
  child.unref();
  return child;
}
