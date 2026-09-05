const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Parser = require('tree-sitter');
const language = require('../bindings/node');
const inventory = require('../data/keyword-inventory.json');
const documented = require('../data/documented-keywords.json');
const aliases = require('../data/keyword-heading-aliases.json');
const { outputs } = require('../scripts/generate-queries.cjs');
const { checkSource } = require('./helpers/check-source.cjs');
const parser = new Parser().setLanguage(language);
const query = new Parser.Query(language, fs.readFileSync('queries/highlights.scm', 'utf8'));

const { fixture } = require('./helpers/keyword-fixtures.cjs');

function markerKey(node) {
  const value = node.childForFieldName('value');
  if (value?.text === 'coverage_probe') return node.childForFieldName('key');
  for (const child of node.namedChildren) {
    const key = markerKey(child);
    if (key) return key;
  }
}

test('every canonical reference heading maps to supported keyword paths', () => {
  assert.equal(documented.revision, inventory.revision);
  assert.equal(require('../package.json').gitlabCiReference.revision, inventory.revision);
  assert.equal(require('../gitlab-ci-reference.lock.json').revision, inventory.revision);
  const supported = new Set(inventory.paths);
  for (const entry of documented.headings) {
    const paths = aliases[entry.path]?.paths || [entry.path];
    for (const key of paths) assert.ok(supported.has(key), `${entry.file}: ${entry.heading} -> ${key}`);
  }
  // Keep exclusions explicit and narrow. Report-payload JSON is outside CI YAML.
  assert.deepEqual(Object.entries(aliases).filter(([, value]) => !value.paths.length).map(([key]) => key), ['external_link']);
});

test('generated inventory and queries have no uncommitted generation drift', () => {
  for (const [file, expected] of Object.entries(outputs())) assert.equal(fs.readFileSync(file, 'utf8'), expected, file);
});

test('GitLab highlights override YAML captures regardless of query iteration order', () => {
  const source = `workflow: {rules: [{if: '$CI_COMMIT_BRANCH'}]}
"example_job":
  script: !reference [.template, script]
`;
  const root = parser.parse(source).rootNode;
  const captures = query.captures(root).filter(c => !c.name.startsWith('_'));
  const structural = captures.filter(c => ['keyword', 'function'].includes(c.name));
  assert.deepEqual(structural.map(c => c.node.text).sort(),
    ['workflow', 'rules', 'if', '"example_job"', 'script', '!reference'].sort());
  for (const expected of structural) {
    const overlapping = captures.filter(c => c.node.startIndex <= expected.node.startIndex &&
      c.node.endIndex > expected.node.startIndex);
    for (const order of [overlapping, overlapping.toReversed()]) {
      const winner = order.reduce((best, candidate) =>
        Number(candidate.setProperties?.priority ?? 100) >= Number(best.setProperties?.priority ?? 100)
          ? candidate : best);
      assert.equal(winner.name, expected.name, expected.node.text);
    }
  }
});

for (const mode of ['block', 'flow', 'mixed']) {
  for (const quote of ['', "'", '"']) {
    test(`every keyword route is captured in ${mode} YAML with ${quote || 'plain'} keys`, () => {
      for (const route of inventory.routes) {
        const source = fixture(route, mode, quote) + '\n';
        const tree = parser.parse(source);
        assert.equal(tree.rootNode.hasError, false, `${route.join(':')}\n${source}`);
        const key = markerKey(tree.rootNode);
        assert.ok(key, route.join(':'));
        const captures = query.captures(tree.rootNode);
        assert.ok(captures.some(capture => capture.name === 'keyword' && capture.node.startIndex === key.startIndex && capture.node.endIndex === key.endIndex),
          `Missing keyword ${route.join(':')}\n${source}`);
      }
    });
  }
}

test('user dictionaries and arbitrary input defaults do not become keyword scopes', () => {
  const source = `variables:
  rules:
    value: text
  script: text
job:
  variables:
    rules: text
  inputs:
    type:
      type: string
      default: {rules: [{if: ordinary text}], script: value}
  parallel:
    matrix:
      - script: [one, two]
  trigger:
    inputs:
      rules: [{if: ordinary text}]
`;
  const root = parser.parse(source).rootNode;
  const captured = query.captures(root).filter(c => c.name === 'keyword');
  assert.deepEqual(captured.map(c => [c.node.startPosition.row + 1, c.node.text]),
    [[1, 'variables'], [3, 'value'], [6, 'variables'], [8, 'inputs'], [10, 'type'],
      [11, 'default'], [12, 'parallel'], [13, 'matrix'], [15, 'trigger'], [16, 'inputs']]);
  assert.equal(checkSource(source).rules, 0);
});

test('deprecated filters inject expressions in block and flow sequences', () => {
  const result = checkSource(`legacy:
  only:
    variables:
      - '$A == "yes"'
      - "$B != null"
  except: {variables: ['$C =~ /^skip/', '$D && !$E']}
`);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rules, 4);
  assert.ok(checkSource('legacy: {only: {variables: ["$A =="]}}').errors.length);
});

test('all supported rules owners receive expression injections', () => {
  const result = checkSource(`spec:
  inputs:
    choice:
      rules:
        - if: '$[[ inputs.toggle ]] == true'
          default: yes
---
include:
  - local: child.yml
    rules: [{if: '$A'}]
workflow:
  rules: [{if: '$B'}]
.hidden:
  rules: [{if: '$C'}]
job:
  rules: [{if: '$D'}]
`);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rules, 5);
});

test('complete keyword fixture parses current and deprecated conditions', () => {
  const result = checkSource(fs.readFileSync('test/fixtures/keywords.gitlab-ci.yml', 'utf8'));
  assert.deepEqual(result.errors, []);
  assert.equal(result.rules, 5);
  assert.equal(result.interpolations, 1);
});

test('implicit mapping pairs in flow sequences retain highlighting and injections', () => {
  const source = 'include: [local: child.yml]\njob:\n  rules: [if: "$A"]\n';
  const tree = parser.parse(source);
  assert.equal(tree.rootNode.hasError, false);
  const keywords = query.captures(tree.rootNode).filter(c => c.name === 'keyword').map(c => c.node.text);
  assert.ok(keywords.includes('local'));
  assert.ok(keywords.includes('if'));
  const result = checkSource(source);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rules, 1);
});

test('inheritance defaults, references, and unknown keys retain YAML syntax', () => {
  const root = parser.parse('default: &defaults\n  image: alpine\njob:\n  <<: *defaults\n  script: !reference [.base, script]\n  future_extension: {custom: value}\n').rootNode;
  assert.equal(root.hasError, false);
  assert.ok(query.captures(root).some(c => c.name === 'keyword' && c.node.text === '!reference'));
  assert.ok(!query.captures(root).some(c => c.name === 'keyword' && c.node.text === 'future_extension'));
});
