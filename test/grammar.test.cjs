const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const Parser = require('tree-sitter');
const language = require('../bindings/node');
const { checkSource, parseCondition } = require('./helpers/check-source.cjs');

const parse = source => new Parser().setLanguage(language).parse(source).rootNode;
const condition = source => parseCondition(source).rootNode;

test('all editor queries compile with the upstream Node binding', () => {
  for (const file of fs.readdirSync('queries')) {
    if (file.endsWith('.scm')) new Parser.Query(language, fs.readFileSync(path.join('queries', file), 'utf8'));
  }
  const injections = new Parser.Query(language, fs.readFileSync('queries/injections.scm', 'utf8'));
  for (const file of ['pipeline.gitlab-ci.yml', 'keywords.gitlab-ci.yml']) {
    const root = parse(fs.readFileSync(path.join('test/fixtures', file), 'utf8'));
    for (const match of injections.matches(root)) {
      assert.equal(match.setProperties['injection.language'], 'gitlab_ci');
      assert.equal(match.captures.filter(c => c.name === 'injection.content').length, 1);
    }
  }
});

test('hidden root-pair metadata preserves YAML fields and excludes nested dictionaries', () => {
  const types = language.nodeTypeInfo.filter(node => node.type.startsWith('_ci_root'));
  assert.ok(types.length > 0);
  const query = new Parser.Query(language, types.flatMap(node => node.subtypes
    .filter(subtype => ['block_mapping_pair', 'flow_pair'].includes(subtype.type))
    .map(subtype => `(${node.type}/${subtype.type} key: (_) @key)`)).join('\n'));
  for (const [source, expected] of [
    ['job:\n  script: echo\n  variables: {script: custom}\nother: {script: echo}\n', ['job', 'other']],
    ['%YAML 1.2\n---\njob: {script: echo}\n', ['job']],
    ['--- &root\njob: {script: echo}\n', ['job']],
    ['? explicit_job\n: {script: echo}\n', ['explicit_job']],
    ['{? flow_job: {script: echo}, "quoted_job": {script: echo}}', ['flow_job', '"quoted_job"']],
    ['spec: {inputs: {name: {default: value}}}\n---\njob: {script: echo}\n', ['spec', 'job']],
    ['[{script: echo}]', []],
    ['{{script: echo}}', []],
  ]) {
    const root = parse(source);
    assert.equal(root.hasError, false, source);
    assert.deepEqual(query.captures(root).map(c => c.node.text), expected, source);
    assert.ok(!root.toString().includes('_ci_'), source);
    for (const pair of root.descendantsOfType(['block_mapping_pair', 'flow_pair'])) {
      assert.ok(pair.childForFieldName('key'), source);
      assert.ok(pair.childForFieldName('value'), source);
    }
  }
});

test('operator precedence and parentheses preserve GitLab rules grouping', () => {
  const expression = condition('$A || $B && !$C == null').firstNamedChild.firstNamedChild;
  assert.equal(expression.childForFieldName('operator').text, '||');
  const and = expression.childForFieldName('right');
  assert.equal(and.childForFieldName('operator').text, '&&');
  const compare = and.childForFieldName('right');
  assert.equal(compare.childForFieldName('operator').text, '==');
  assert.equal(compare.childForFieldName('left').type, 'unary_expression');
  const grouped = condition('($A || $B) && $C').firstNamedChild.firstNamedChild;
  assert.equal(grouped.childForFieldName('left').type, 'parenthesized_expression');
});

test('configuration contexts, indexing, and function pipelines', () => {
  const root = parse('image:$[[ component.name ]]:$[[ inputs.servers[0][1].host | expand_vars | truncate(0, 5) ]]-$[[ matrix.OS ]]');
  assert.equal(root.hasError, false);
  assert.equal(root.descendantsOfType('interpolation').length, 3);
  assert.deepEqual(root.descendantsOfType('index').map(n => n.text), ['[0]', '[1]']);
  assert.deepEqual(root.descendantsOfType('function_call').map(n => n.childForFieldName('name').text), ['expand_vars', 'truncate']);
});

test('ordinary shell text and trailing dollars do not hide interpolations', () => {
  for (const source of ['$', '$[', '$HOME ${HOME} $(pwd) $$', 'text\n$\n']) {
    assert.equal(parse(source).hasError, false, source);
  }
  const root = parse('$$[[ inputs.x ]]$[[ matrix.OS ]]$[');
  assert.equal(root.hasError, false);
  assert.equal(root.descendantsOfType('interpolation').length, 2);
});

test('malformed expressions produce ERROR or MISSING nodes', () => {
  for (const source of ['$[[ inputs.x', '$[[ ]]', '$[[ inputs.x + 1 ]]', '$[[ inputs.x | truncate(1,) ]]']) {
    assert.equal(parse(source).hasError, true, source);
  }
  for (const source of ['$A ==', '$A &&', '($A || $B', '$A =~ /unclosed', '$A === "yes"']) {
    assert.equal(condition(source).hasError, true, source);
  }
});

test('regex escapes, character classes, flags, and variables', () => {
  const root = condition('$BRANCH =~ /^release\\/[a-z/]+$/i && $OTHER !~ $PATTERN');
  assert.equal(root.hasError, false);
  assert.equal(root.descendantsOfType('regex').length, 1);
  assert.equal(root.descendantsOfType('regex_flags')[0].text, 'i');
});

test('predefined variables have exact, stable highlights while custom variables remain valid', () => {
  const { revision, names } = require('../data/predefined-variables.json');
  assert.equal(revision, require('../package.json').gitlabCiReference.revision);
  for (const name of ['CI', 'CI_COMMIT_BRANCH', 'GITLAB_CI', 'CHAT_INPUT', 'KUBECONFIG',
    'CI_MERGE_REQUEST_IID', 'CI_EXTERNAL_PULL_REQUEST_IID', 'AUTO_DEVOPS_EXPLICITLY_ENABLED', 'HARBOR_URL']) {
    assert.ok(names.includes(name), name);
  }
  const query = new Parser.Query(language, fs.readFileSync('queries/highlights.scm', 'utf8'));
  const custom = ['CI_CUSTOM_VALUE', 'CI_COMMIT_BRANCH_EXTRA', 'CUSTOM_VALUE', 'ci', 'gitlab_ci', 'CHAT_INPUT_EXTRA'];
  for (const [variables, expected] of [[names, 'variable.builtin'], [custom, 'variable']]) {
    const root = condition(variables.map(name => `$${name}`).join(' || '));
    assert.equal(root.hasError, false);
    const captures = query.captures(root).filter(c => c.name.startsWith('variable'));
    assert.equal(root.descendantsOfType('variable').length, variables.length);
    for (const variable of root.descendantsOfType('variable')) {
      const overlapping = captures.filter(c => c.node.startIndex === variable.startIndex);
      assert.ok(overlapping.length, variable.text);
      if (expected === 'variable') assert.ok(overlapping.every(c => c.name === 'variable'), variable.text);
      for (const order of [overlapping, overlapping.toReversed()]) {
        const winner = order.reduce((best, candidate) =>
          Number(candidate.setProperties?.priority ?? 100) >= Number(best.setProperties?.priority ?? 100)
            ? candidate : best);
        assert.equal(winner.name, expected, variable.text);
      }
    }
  }
});

test('script injections highlight plain and braced variables without replacing YAML strings', () => {
  const source = `default:
  before_script: 'echo $GITLAB_CI'
before_script: [echo $CHAT_INPUT]
after_script: echo $CI
job:
  script:
    - git remote set-url origin https://\${BOT_CI_USER_NAME}:\${BOT_CI_TOKEN}@\${CI_SERVER_HOST}/\${CI_PROJECT_PATH}.git
    - 'echo "$CI_DEFAULT_BRANCH" $CI_CUSTOM_VALUE'
    - "echo \${GITLAB_USER_LOGIN}"
    - |
      echo \${CI_COMMIT_SHA}
      echo $CUSTOM
    - >-
      echo $CI_JOB_ID
    - echo $[[ inputs.command ]] $CI
  after_script: ['echo \${CI_JOB_STATUS}']
  variables: {script: 'echo $CI_DO_NOT_INJECT'}
  description: 'echo $CI_DO_NOT_INJECT'
`;
  assert.deepEqual(checkSource(source).errors, []);
  const root = parse(source);
  assert.equal(root.firstNamedChild.type, 'document');
  const injections = new Parser.Query(language, fs.readFileSync('queries/injections.scm', 'utf8'));
  const highlights = new Parser.Query(language, fs.readFileSync('queries/highlights.scm', 'utf8'));
  const builtins = [];
  const ordinary = [];
  const ranges = new Set();
  for (const match of injections.matches(root)) {
    assert.equal(match.setProperties['injection.language'], 'gitlab_ci');
    const contents = match.captures.filter(c => c.name === 'injection.content');
    assert.equal(contents.length, 1);
    const node = contents[0].node;
    const key = `${node.startIndex}:${node.endIndex}`;
    assert.ok(!ranges.has(key), `Duplicate script injection: ${node.text}`);
    ranges.add(key);
    const tree = new Parser().setLanguage(language).parse(source, null, { includedRanges: [{
      startIndex: node.startIndex, endIndex: node.endIndex,
      startPosition: node.startPosition, endPosition: node.endPosition,
    }] });
    assert.equal(tree.rootNode.hasError, false, node.text);
    for (const capture of highlights.captures(tree.rootNode)) {
      if (capture.name === 'variable.builtin') builtins.push(capture.node.text);
      if (capture.name === 'variable' && capture.node.type === 'variable') ordinary.push(capture.node.text);
    }
  }
  assert.deepEqual(builtins.sort(), ['$GITLAB_CI', '$CHAT_INPUT', '$CI', '${CI_SERVER_HOST}',
    '${CI_PROJECT_PATH}', '$CI_DEFAULT_BRANCH', '${GITLAB_USER_LOGIN}', '${CI_COMMIT_SHA}',
    '$CI_JOB_ID', '$CI', '${CI_JOB_STATUS}'].sort());
  assert.deepEqual(ordinary.filter(name => !builtins.includes(name)).sort(),
    ['${BOT_CI_USER_NAME}', '${BOT_CI_TOKEN}', '$CI_CUSTOM_VALUE', '$CUSTOM'].sort());
});

test('all script owners inject variables through quoted keys and nested sequences', () => {
  const { fixture } = require('./helpers/keyword-fixtures.cjs');
  const routes = require('../data/keyword-inventory.json').routes.filter(route =>
    ['script', 'before_script', 'after_script'].includes(route.at(-1)));
  const query = new Parser.Query(language, fs.readFileSync('queries/injections.scm', 'utf8'));
  for (const route of routes) {
    for (const mode of ['block', 'flow', 'mixed']) {
      for (const quote of ['', "'", '"']) {
        for (const value of ["'echo ${CI_COMMIT_SHA}'", "['echo ${CI_COMMIT_SHA}']",
          '['.repeat(10) + "'echo ${CI_COMMIT_SHA}'" + ']'.repeat(10)]) {
          const source = fixture(route, mode, quote).replace('coverage_probe', value);
          const root = parse(source);
          assert.equal(root.hasError, false, source);
          const matches = query.matches(root).filter(m => m.setProperties['gitlab_ci.kind'] === 'template');
          assert.equal(matches.length, 1, source);
          assert.equal(matches[0].captures.find(c => c.name === 'injection.content').node.text, "'echo ${CI_COMMIT_SHA}'");
        }
      }
    }
  }
  assert.deepEqual(checkSource('job:\n  script:\n    ' + '- '.repeat(10) + 'echo $CI\n').errors, []);
});

test('template variables preserve interpolation, escapes, and condition syntax', () => {
  const root = parse('echo $CI ${CI} $CUSTOM ${CUSTOM} \\$CI $$CI $[[ inputs.command ]]');
  assert.equal(root.hasError, false);
  assert.deepEqual(root.descendantsOfType('variable').map(node => node.text), ['$CI', '${CI}', '$CUSTOM', '${CUSTOM}']);
  assert.equal(root.descendantsOfType('interpolation').length, 1);
  // GitLab expands configuration expressions before the shell sees escapes.
  assert.equal(parse('echo \\$[[ inputs.command ]]').descendantsOfType('interpolation').length, 1);
  const query = new Parser.Query(language, fs.readFileSync('queries/highlights.scm', 'utf8'));
  const names = require('../data/predefined-variables.json').names;
  const braced = parse(names.map(name => '${' + name + '}').join(' '));
  assert.equal(braced.hasError, false);
  assert.equal(query.captures(braced).filter(c => c.name === 'variable.builtin').length, names.length);
  assert.equal(condition('${CI}').hasError, true);
});

test('the former condition corpus retains its syntax trees through one language', () => {
  const shape = node => `(${node.type}${node.namedChildren.map(child => ` ${shape(child)}`).join('')})`;
  for (const entry of require('./fixtures/conditions.json')) {
    const root = condition(entry.source);
    assert.equal(root.hasError, false, entry.name);
    assert.equal(shape(root.firstNamedChild), entry.expected, entry.name);
  }
});

test('entry selection preserves YAML documents and recognizes condition pairs', () => {
  for (const source of [
    '# An unfinished $[[ in a comment\njob: {script: echo}\n',
    '# $[[ inputs.name ]]\njob: {script: echo}\n',
    '"$[[ inputs.name ]]": {script: echo}\n',
    '$[[ inputs.name ]]: {script: echo}\n',
    'if: {script: echo}\n',
    'if:\n  "script": echo\n',
    'if: !reference [.base]\n',
    'variables: {VALUE: "$[[ inputs.value ]]"}\n',
  ]) {
    const root = parse(source);
    assert.equal(root.hasError, false, source);
    assert.equal(root.firstNamedChild.type === 'comment' ? root.namedChild(1).type : root.firstNamedChild.type,
      'document', source);
  }
  for (const source of ['true', 'null', '42', '"a" == "b"', '$CI_COMMIT_BRANCH']) {
    const root = condition(source);
    assert.equal(root.hasError, false, source);
    assert.equal(root.firstNamedChild.type, 'condition', source);
  }
});

test('deprecated condition lists retain anchors, aliases, and references', () => {
  const result = checkSource(`job:
  only:
    variables: &conditions
      - &condition '$A == "yes"'
      - *condition
      - !reference [.base, only, variables]
  except: {variables: ['$B', *condition, !reference [.base, except, variables]]}
`);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rules, 2);
});

test('condition pairs support compact flow syntax, key spacing, and YAML comments', () => {
  const compact = checkSource(`job: {rules: [{"if":"$A"}, {'if' : '$B'}], only: {"variables":["$C"]}}`);
  assert.deepEqual(compact.errors, []);
  assert.equal(compact.rules, 3);
  const commented = checkSource(`job:
  rules:
    - if: # explanation
        '$A'
    - if: '$B' # explanation
  only:
    variables: # explanation
      - '$C' # explanation
      # before the next value
      - '$D'
`);
  assert.deepEqual(commented.errors, []);
  assert.equal(commented.rules, 4);
});

test('synthetic pipeline parses raw injections and decoded YAML values', () => {
  const result = checkSource(fs.readFileSync('test/fixtures/pipeline.gitlab-ci.yml', 'utf8'));
  assert.deepEqual(result.errors, []);
  assert.equal(result.rules, 4);
  assert.equal(result.interpolations, 9);
});

test('rules injections support block, flow, quoted keys, YAML escaping, and folded values', () => {
  const source = `job:
  rules:
    - if: '$A == "one"'
    - "if": "$A == \\"two\\""
    - 'if': '$A == ''three'''
    - {if: '$A != null'}
    - if: >-
        $A &&
        $B
other: {rules: [{if: '$C || $D'}], script: echo}
variables:
  if: this is not an expression
`;
  const result = checkSource(source);
  assert.deepEqual(result.errors, []);
  assert.equal(result.rules, 6);
});

test('keywords are scoped to global and job keys, not variable names', () => {
  const source = 'variables:\n  script: hello\njob:\n  script: echo\n  variables:\n    stage: user-value\n';
  const root = parse(source);
  const query = new Parser.Query(language, fs.readFileSync('queries/highlights.scm', 'utf8'));
  const keywords = query.captures(root).filter(c => c.name === 'keyword');
  assert.deepEqual(keywords.map(c => [c.node.text, c.node.startPosition.row]), [['variables', 0], ['script', 3], ['variables', 4]]);
  assert.deepEqual(query.captures(root).filter(c => c.name === 'function').map(c => c.node.text), ['job']);
});

test('malformed YAML and malformed embedded conditions fail the file checker', () => {
  assert.ok(checkSource('job: [unterminated\n').errors.length > 0);
  assert.ok(checkSource('job:\n  rules:\n    - if: $A ==\n').errors.length > 0);
});

test('incremental edits agree with a fresh parse', () => {
  const query = new Parser.Query(language, fs.readFileSync('queries/highlights.scm', 'utf8'));
  const captures = root => query.captures(root).filter(c => !c.name.startsWith('_'))
    .map(c => [c.name, c.node.startIndex, c.node.endIndex]).sort();
  for (let [name, before, from, to] of [
    ['yaml', 'job:\n  script: echo old\n', 'old', 'new value'],
    ['rules', '$A == "old" && $B', 'old', 'new value'],
    ['expression', 'echo $[[ inputs.old ]]', 'old', 'new_value'],
    ['expression', 'image:$[[ inputs.tag ]]', 'image:', 'image: '],
    ['yaml', 'image: $[[ inputs.tag ]]', 'image: ', 'image:'],
    ['expression', 'echo ${CI_COMMIT_SHA}', 'CI_COMMIT_SHA', 'CUSTOM_VALUE'],
    ['expression', 'echo $CI', '$CI', 'plain text'],
    ['yaml', 'echo plain text', 'plain text', '$CI'],
    ['yaml', 'job:\n  script: echo\n  child: echo\n', '  child:', 'child:'],
    ['yaml', 'job:\n  script: echo\nchild: echo\n', 'child:', '  child:'],
  ]) {
    const parser = new Parser().setLanguage(language);
    if (name === 'rules') before = `if: ${before}`;
    const tree = parser.parse(before);
    const startIndex = before.indexOf(from);
    const prefix = before.slice(0, startIndex).split('\n');
    const startPosition = { row: prefix.length - 1, column: prefix.at(-1).length };
    tree.edit({ startIndex, oldEndIndex: startIndex + from.length, newEndIndex: startIndex + to.length,
      startPosition, oldEndPosition: { ...startPosition, column: startPosition.column + from.length },
      newEndPosition: { ...startPosition, column: startPosition.column + to.length } });
    const after = before.slice(0, startIndex) + to + before.slice(startIndex + from.length);
    const changed = parser.parse(after, tree).rootNode;
    assert.equal(changed.hasError, false);
    const fresh = parser.parse(after).rootNode;
    assert.equal(changed.toString(), fresh.toString());
    assert.deepEqual(captures(changed), captures(fresh));
  }
});
