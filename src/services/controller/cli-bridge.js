import { spawn } from 'node:child_process';

export function createCliBridge({ cliTargets = {}, repoRoot = process.cwd(), env = process.env, logger = null } = {}) {
  const runCliCommand = (target, args = []) => new Promise((resolve, reject) => {
    const script = cliTargets[target];
    if (!script) {
      reject(new Error(`Unknown CLI target: ${target}`));
      return;
    }
    const isJs = script.endsWith('.js');
    const npxCmd = process.platform === 'win32' ? 'npx.cmd' : 'npx';
    const cmd = isJs ? 'node' : npxCmd;
    const cmdArgs = isJs ? [script, ...args] : ['tsx', script, ...args];
    logger?.info?.('runCliCommand', { target, script, args: args.join(' ') });
    const child = spawn(cmd, cmdArgs, {
      cwd: repoRoot,
      env,
      windowsHide: true,
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (chunk) => { stdout += chunk.toString(); });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString(); });
    child.on('error', (err) => {
      logger?.warn?.('cli spawn error', { target, error: err?.message || String(err) });
      reject(err);
    });
    child.on('close', (code) => {
      logger?.info?.('cli exit', { target, code });
      if (stdout.trim()) logger?.info?.('cli stdout', { target, stdout: stdout.trim() });
      if (stderr.trim()) logger?.warn?.('cli stderr', { target, stderr: stderr.trim() });
      if (code === 0) {
        resolve(normalizeCliResult(parseCliJson(stdout)));
      } else {
        reject(new Error(stderr.trim() || `CLI(${target}) exited with code ${code}`));
      }
    });
  });

  const parseCliJson = (output = '') => {
    const trimmed = output.trim();
    if (!trimmed) return {};
    const match = trimmed.match(/(\{[\s\S]*\})\s*$/);
    if (match) {
      try {
        return JSON.parse(match[1]);
      } catch {
        // ignore
      }
    }
    try {
      return JSON.parse(trimmed);
    } catch {
      return { raw: trimmed };
    }
  };

  const normalizeCliResult = (result) => {
    if (result && typeof result === 'object' && 'data' in result && result.success) {
      return result.data;
    }
    return result;
  };

  const fetchSessions = async () => {
    try {
      const res = await runCliCommand('session-manager', ['list']);
      const sessions = res?.sessions || res?.data?.sessions || res?.data || [];
      return Array.isArray(sessions) ? sessions : [];
    } catch {
      return [];
    }
  };

  const findSessionByProfile = (sessions, profile) => {
    if (!profile) return null;
    return (
      sessions.find(
        (session) =>
          session?.profileId === profile
          || session?.profile_id === profile
          || session?.session_id === profile
          || session?.sessionId === profile,
      ) || null
    );
  };

  return {
    runCliCommand,
    fetchSessions,
    findSessionByProfile,
  };
}
