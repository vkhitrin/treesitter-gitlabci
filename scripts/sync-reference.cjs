const fs = require('node:fs');
const path = require('node:path');
const { createHash } = require('node:crypto');
const { outputs } = require('./generate-queries.cjs');
const { keywordRoutes, canonicalPath } = require('./keyword-model.cjs');
const { replaceFiles } = require('./replace-files.cjs');
const aliases = require('../data/keyword-heading-aliases.json');
const project = 'https://gitlab.com/api/v4/projects/gitlab-org%2Fgitlab';
const structural = new Set(['$ref', 'properties', 'patternProperties', 'additionalProperties',
  'items', 'allOf', 'oneOf', 'anyOf', 'then', 'else', 'definitions', 'deprecated']);

// Retain structural facts and property names, not the upstream prose or examples.
function structure(value) {
  if (Array.isArray(value)) return value.map(structure);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value).filter(([key]) => structural.has(key))
    .map(([key, item]) => [key, ['properties', 'patternProperties', 'definitions'].includes(key)
      ? Object.fromEntries(Object.entries(item).map(([name, child]) => [name, structure(child)]))
      : structure(item)]));
}

async function syncReference({ root = path.resolve(__dirname, '..'), ref, fetchImpl = fetch } = {}) {
  async function get(url) {
    const response = await fetchImpl(url, { signal: AbortSignal.timeout(30_000) });
    if (!response.ok) throw new Error(`${url}: HTTP ${response.status}`);
    return response.text();
  }
  // Parse failures propagate to main().catch().
  // ast-grep-ignore: js.json-parse-without-try
  const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  ref ||= manifest.gitlabCiReference.revision;
  // ast-grep-ignore: js.json-parse-without-try
  const revision = JSON.parse(await get(`${project}/repository/commits/${encodeURIComponent(ref)}`)).id; // parse failures propagate to main().catch()
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('Expected a full Git commit ID for the reference');
  const files = [];
  for (let page = 1; ; page++) {
    // ast-grep-ignore: js.json-parse-without-try
    const entries = JSON.parse(await get(`${project}/repository/tree?path=doc%2Fci%2Fyaml&ref=${revision}&recursive=true&per_page=100&page=${page}`)); // parse failures propagate to main().catch()
    for (const entry of entries) {
      if (entry.type !== 'blob') continue;
      if (!entry.path.startsWith('doc/ci/yaml/') || entry.path.split('/').some(part => ['..', '.', ''].includes(part))) {
        throw new Error(`Unexpected upstream file path: ${entry.path}`);
      }
      if (entry.path.endsWith('.md')) files.push(entry.path);
    }
    if (entries.length < 100) break;
  }
  const variablesPath = 'doc/ci/variables/predefined_variables.md';
  files.push('app/assets/javascripts/editor/schema/ci.json', 'doc/ci/jobs/job_rules.md', 'doc/ci/inputs/_index.md', variablesPath);
  const sources = await Promise.all(files.map(async file => {
    const text = await get(`https://gitlab.com/gitlab-org/gitlab/-/raw/${revision}/${file.split('/').map(encodeURIComponent).join('/')}`);
    return { path: file, text, sha256: createHash('sha256').update(text).digest('hex') };
  }));
  const headings = [];
  for (const source of sources) {
    const file = path.basename(source.path);
    if (!source.path.startsWith('doc/ci/yaml/') || !['_index.md', 'artifacts_reports.md', 'deprecated_keywords.md'].includes(file)) continue;
    for (const heading of source.text.matchAll(/^#{2,6} (.+)$/gm)) {
      for (const code of heading[1].matchAll(/`([^`]+)`/g)) {
        if (/^[a-z_]+(?:(?::|\.)[a-z_]+)*$/.test(code[1])) headings.push({ file, heading: code[1], path: code[1].replaceAll('.', ':') });
      }
    }
  }
  // ast-grep-ignore: js.json-parse-without-try
  const reference = { revision, schema: structure(JSON.parse(sources.find(source => source.path.endsWith('/ci.json')).text)) }; // parse failures propagate to main().catch()
  const variablesText = sources.find(source => source.path === variablesPath).text;
  const predefined = { revision, names: [...new Set([...variablesText.matchAll(
    /^(?:\|\s*|[ \t]*- )`([A-Z][A-Z0-9_]*)`(?=\s*\||:|\s*$)/gm,
  )].map(match => match[1]))].sort() };
  const generated = outputs(reference, predefined);
  const supported = new Set(keywordRoutes(reference.schema).map(canonicalPath));
  for (const entry of headings) {
    for (const keyword of aliases[entry.path]?.paths || [entry.path]) {
      if (!supported.has(keyword)) throw new Error(`Unsupported documented keyword: ${entry.heading}. Update the keyword model or heading aliases before syncing.`);
    }
  }
  manifest.gitlabCiReference.revision = revision;
  const json = value => JSON.stringify(value, null, 2) + '\n';
  replaceFiles(root, {
    'data/keyword-schema.json': json(reference),
    'data/documented-keywords.json': json({ revision, headings }),
    'data/predefined-variables.json': json(predefined),
    'gitlab-ci-reference.lock.json': json({ lockfileVersion: 1, retrieved: new Date().toISOString().slice(0, 10), revision,
      sources: sources.map(({ path, sha256 }) => ({ path, sha256 })).sort((a, b) => a.path.localeCompare(b.path)) }),
    ...generated,
    'package.json': json(manifest),
  });
  return revision;
}

async function main() {
  if (process.argv.length > 3) throw new Error('Usage: mise run reference:sync -- [ref]');
  const revision = await syncReference({ ref: process.argv[2] });
  console.log(`Pinned GitLab reference to ${revision}. Run mise run to check coverage before accepting this update.`);
}

if (require.main === module) main().catch(error => { console.error(error.message); process.exitCode = 1; });
module.exports = { structure, syncReference };
