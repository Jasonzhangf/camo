import { callAPI, ensureBrowserService } from '../utils/browser-service.mjs';

export async function handleSystemCommand(args) {
  await ensureBrowserService();

  const sub = args[1];

  if (sub === 'display') {
    const result = await callAPI('system:display', {});
    console.log(JSON.stringify(result, null, 2));
  } else {
    throw new Error('Usage: camo system display');
  }
}
