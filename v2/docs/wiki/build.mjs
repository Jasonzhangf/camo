#!/usr/bin/env node
// Build wiki pages from registry JSON. Pure text generation.
import fsp from 'node:fs/promises';
import path from 'node:path';
import {
  renderFunctionMapHtml,
  renderFunctionMapMarkdown,
  renderMainlineCallMapHtml,
  renderMainlineCallMapMarkdown,
} from './function_map_view.mjs';

const [, , REG, OUT] = process.argv;
if (!REG || !OUT) {
  console.error('usage: build.mjs <registry-dir> <out-dir>');
  process.exit(2);
}
const fs = {
  async readFile(p, enc) { return fsp.readFile(p, enc); },
  async writeFile(p, data, enc) { return fsp.writeFile(p, data, enc); },
};

async function readJson(p) {
  const raw = await fs.readFile(p, 'utf8');
  return JSON.parse(raw);
}

function htmlEscape(s) {
  return String(s ?? '').replace(/[&<>]/g, (c) => ({'&':'&amp;','<':'&lt;','>':'&gt;'}[c]));
}

async function buildResourceTable() {
  const reg = await readJson(path.join(REG, 'resources.json'));
  const rows = reg.resources.map((r) => `
    <tr>
      <td><code>${htmlEscape(r.resource_id)}</code></td>
      <td>${htmlEscape(r.layer)}</td>
      <td><code>${htmlEscape(r.truth_owner)}</code></td>
      <td><code>${htmlEscape(r.verification_gate)}</code></td>
      <td><span class="pill ${htmlEscape(r.status || 'design')}">${htmlEscape(r.status || 'design')}</span></td>
    </tr>`).join('\n');
  const arch = path.join(OUT, 'architecture.html');
  const text = await fs.readFile(arch, 'utf8');
  const out = text.replace(/<tbody id="tbody-resources"><![^]*?<\/tbody>/, `<tbody id="tbody-resources">${rows}</tbody>`);
  await fs.writeFile(arch, out, 'utf8');

  const detail = reg.resources.map((r) => `
    <section id="r-${r.resource_id}">
      <h2><code>${r.resource_id}</code></h2>
      <p><strong>Layer:</strong> ${r.layer} - <strong>Truth owner:</strong> <code>${r.truth_owner}</code> - <strong>Store:</strong> ${r.truth_store}</p>
      ${r.truth_path ? `<p><strong>Truth path:</strong> <code>${r.truth_path}</code></p>` : ''}
      <h3>Reads</h3><ul>${r.read_paths.map((p) => `<li><code>${p}</code></li>`).join('')}</ul>
      <h3>Writes</h3><ul>${r.write_paths.map((p) => `<li><code>${p}</code></li>`).join('')}</ul>
      ${r.indirect_paths && r.indirect_paths.length ? `<h3>Indirect</h3><ul>${r.indirect_paths.map((p)=>`<li><code>${p}</code></li>`).join('')}</ul>` : ''}
      <h3>Forbidden</h3><ul>${r.forbidden_paths.map((p) => `<li><code>${p}</code></li>`).join('')}</ul>
      ${r.design_note ? `<p><strong>Note:</strong> ${r.design_note}</p>` : ''}
      <p><a href="#resource-index">back to index</a></p>
    </section>`).join('\n');

  const indexList = reg.resources.map((r) => `<li><a href="#r-${r.resource_id}">${r.resource_id}</a></li>`).join('');
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>camo v2 resources</title>
<style>body { font:14px/1.5 -apple-system, BlinkMacSystemFont, system-ui, sans-serif; max-width: 800px; margin: 24px auto; padding: 0 16px; }
code { font-family: ui-monospace, SFMono-Regular, Menlo, monospace; }
.pill { display:inline-block; font-size:12px; padding:2px 8px; border-radius:999px; background:#eee; }
.pill.design { background:#ffecb3; color:#6d4c00; }
.pill.active { background:#c8e6c9; color:#1b5e20; }
section { border-top: 1px solid #ddd; padding-top: 16px; margin-top: 16px; }</style></head>
<body>
<h1>camo v2 resources</h1>
<p>Mirror of <code>v2/resources/registry/resources.json</code>. Status of every entry: design until its corresponding gate is green and forbidden paths are physically removed from v1.</p>
<h2 id="resource-index">Index</h2>
<ul>${indexList}</ul>
${detail.trimEnd()}
</body></html>`;
  await fs.writeFile(path.join(OUT, 'resources.html'), html.replace(/[ \t]+$/gm, ''), 'utf8');
}

async function buildEdgeTable() {
  const reg = await readJson(path.join(REG, 'edges.json'));
  const rows = reg.edges.map((e) => `
    <tr>
      <td><code>${htmlEscape(e.from)}</code></td>
      <td><code>${htmlEscape(e.to)}</code></td>
      <td>${htmlEscape(e.kind)}</td>
      <td>${htmlEscape(e.reason)}</td>
    </tr>`).join('\n');
  const forb = reg.forbidden_edges.map((e) => `
    <tr>
      <td><code>${htmlEscape(e.from)}</code></td>
      <td><code>${htmlEscape(e.to)}</code></td>
      <td>${htmlEscape(e.reason)}</td>
    </tr>`).join('\n');
  const arch = path.join(OUT, 'architecture.html');
  const text = await fs.readFile(arch, 'utf8');
  const withForbidden = text.replace(
    /<\/ul>\s*<h2>Checklist/,
    `<h3>Forbidden edges</h3><table><thead><tr><th>from</th><th>to</th><th>reason</th></tr></thead><tbody>${forb}</tbody></table></ul><h2>Checklist`
  );
  const out = withForbidden.replace(/<tbody id="tbody-edges"><![^]*?<\/tbody>/, `<tbody id="tbody-edges">${rows}</tbody>`);
  await fs.writeFile(arch, out, 'utf8');
}

async function buildFunctionSurfaces() {
  const docsDir = path.resolve(REG, '..', '..', 'docs');
  const functionMap = await readJson(path.join(docsDir, 'function_map.json'));
  const featureTests = await readJson(path.join(docsDir, 'feature_tests.json'));
  const callMap = await readJson(path.join(docsDir, 'mainline_call_map.json'));
  await fs.writeFile(
    path.join(docsDir, 'migration_contracts', 'function_map.md'),
    renderFunctionMapMarkdown(functionMap, featureTests),
    'utf8',
  );
  await fs.writeFile(
    path.join(docsDir, 'migration_contracts', 'mainline_call_map.md'),
    renderMainlineCallMapMarkdown(callMap),
    'utf8',
  );

  const architecturePath = path.join(OUT, 'architecture.html');
  const architecture = await fs.readFile(architecturePath, 'utf8');
  const withFunctionMap = architecture.replace(
    /<!-- GENERATED:function-map:start[^]*?<!-- GENERATED:function-map:end -->/,
    renderFunctionMapHtml(functionMap, featureTests),
  );
  const withCallMap = withFunctionMap.replace(
    /<!-- GENERATED:mainline-call-map:start[^]*?<!-- GENERATED:mainline-call-map:end -->/,
    renderMainlineCallMapHtml(callMap),
  );
  await fs.writeFile(architecturePath, withCallMap, 'utf8');
}

await buildResourceTable();
await buildEdgeTable();
await buildFunctionSurfaces();
console.log('wiki built');
