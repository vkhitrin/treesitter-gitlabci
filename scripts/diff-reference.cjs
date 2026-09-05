const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const repository = 'https://gitlab.com/gitlab-org/gitlab';
const api = 'https://gitlab.com/api/v4/projects/gitlab-org%2Fgitlab';
const scope = 'doc/ci/yaml';
const variablesPath = 'doc/ci/variables/predefined_variables.md';

async function compareReference({ reference, ref = 'master', fetchImpl = fetch }) {
  async function get(url) {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response;
  }

  // Resolve the moving ref once so every request uses the same snapshot.
  const upstream = await (await get(`${api}/repository/commits/${encodeURIComponent(ref)}`)).json();
  if (!/^[a-f0-9]{40}$/.test(upstream.id) || !/^[a-f0-9]{40}$/.test(reference.revision)) {
    throw new Error('Expected full Git commit IDs for the pinned and upstream references');
  }

  async function tree(revision) {
    const files = new Map();
    for (const directory of [scope, path.posix.dirname(variablesPath)]) {
      for (let page = 1; ; page++) {
        const params = new URLSearchParams({ path: directory, ref: revision, recursive: 'true', per_page: '100', page: String(page) });
        const entries = await (await get(`${api}/repository/tree?${params}`)).json();
        for (const entry of entries) {
          if (entry.type !== 'blob') continue;
          if (!entry.path.startsWith(`${directory}/`) || entry.path.split('/').some(part => ['..', '.', ''].includes(part))) {
            throw new Error(`Unexpected upstream file path: ${entry.path}`);
          }
          if (directory === scope || entry.path === variablesPath) files.set(entry.path, entry.id);
        }
        if (entries.length < 100) break;
      }
    }
    return files;
  }

  const pinnedFiles = await tree(reference.revision);
  const upstreamFiles = upstream.id === reference.revision ? pinnedFiles : await tree(upstream.id);
  const changed = [...new Set([...pinnedFiles.keys(), ...upstreamFiles.keys()])]
    .sort().filter(file => pinnedFiles.get(file) !== upstreamFiles.get(file));
  let diff = '';
  if (changed.length) {
    const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'gitlab-ci-reference-'));
    try {
      for (const [side, revision, files] of [
        ['pinned', reference.revision, pinnedFiles], ['upstream', upstream.id, upstreamFiles],
      ]) {
        fs.mkdirSync(path.join(temporary, side));
        for (const file of changed) {
          if (!files.has(file)) continue;
          const url = `${repository}/-/raw/${revision}/${file.split('/').map(encodeURIComponent).join('/')}`;
          const content = Buffer.from(await (await get(url)).arrayBuffer());
          const destination = path.join(temporary, side, file);
          fs.mkdirSync(path.dirname(destination), { recursive: true });
          fs.writeFileSync(destination, content);
        }
      }
      // Compare complete file contents locally to avoid server-side diff limits.
      const result = spawnSync('git', ['diff', '--no-index', '--no-ext-diff', '--no-textconv',
        '--no-renames', '--color=never', '--no-prefix', '--', 'pinned', 'upstream'], {
        cwd: temporary, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024,
      });
      if (result.error) throw result.error;
      if (![0, 1].includes(result.status)) throw new Error(`git diff failed: ${result.stderr}`);
      diff = result.stdout;
    } finally {
      fs.rmSync(temporary, { recursive: true, force: true });
    }
  }

  const lines = [
    `Checked: ${new Date().toISOString()}`,
    `Scope: ${scope} (recursive), ${variablesPath}`,
    `Pinned: ${reference.revision}`,
    `Pinned URL: ${repository}/-/tree/${reference.revision}/${scope}`,
    `Upstream (${ref}): ${upstream.id} (committed ${upstream.committed_date})`,
    `Upstream URL: ${repository}/-/tree/${upstream.id}/${scope}`,
    `Files: ${pinnedFiles.size} pinned, ${upstreamFiles.size} upstream, ${changed.length} changed`,
    '',
  ];
  for (const file of changed) lines.push(`${!pinnedFiles.has(file) ? 'A' : !upstreamFiles.has(file) ? 'D' : 'M'} ${file}`);
  if (changed.length) lines.push('', diff.trimEnd());
  else lines.push('No documentation changes.');
  return { log: lines.join('\n') + '\n', diff };
}

async function main() {
  if (process.argv.length > 3) throw new Error('Usage: mise run reference:diff -- [upstream-ref]');
  // Parse failures propagate to main().catch().
  // ast-grep-ignore: js.json-parse-without-try
  const { gitlabCiReference: reference } = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  console.log(`Pinned GitLab revision: ${reference.revision}`);
  console.log(`Comparing ${scope} and ${variablesPath} with upstream ${process.argv[2] || 'master'}...`);
  const result = await compareReference({ reference, ref: process.argv[2] || 'master' });
  const directory = path.join(root, 'build/reference');
  fs.mkdirSync(directory, { recursive: true });
  fs.writeFileSync(path.join(directory, 'latest.log'), result.log);
  fs.writeFileSync(path.join(directory, 'latest.diff'), result.diff);
  process.stdout.write(result.log);
  console.log('Saved build/reference/latest.log and build/reference/latest.diff');
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { compareReference };
