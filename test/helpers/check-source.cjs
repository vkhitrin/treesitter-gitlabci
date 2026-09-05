const fs = require('node:fs');
const path = require('node:path');
const Parser = require('tree-sitter');
const YAML = require('yaml');
const language = require('../../bindings/node');

const parser = new Parser().setLanguage(language);
const injections = new Parser.Query(language,
  fs.readFileSync(path.join(__dirname, '../../queries/injections.scm'), 'utf8'));
const range = node => ({
  startIndex: node.startIndex, endIndex: node.endIndex,
  startPosition: node.startPosition, endPosition: node.endPosition,
});

// Conditions are parsed with the same key/value context captured by queries.
function parseCondition(value) {
  return parser.parse(`if: ${value}`);
}

function errors(node) {
  if (node.type === 'ERROR' || node.isMissing) return [node];
  return node.children.flatMap(errors);
}

function checkSource(source, filename = '<input>') {
  const tree = parser.parse(source);
  const result = { files: 1, rules: 0, interpolations: 0, errors: [] };
  function inspect(parsed, kind) {
    for (const node of errors(parsed.rootNode)) {
      result.errors.push(`${filename}:${node.startPosition.row + 1}:${node.startPosition.column + 1}: ${kind}: ${node.type}${node.isMissing ? ' (missing)' : ''}`);
    }
  }
  inspect(tree, 'yaml');
  const seen = new Set();
  const matches = injections.matches(tree.rootNode);
  if (injections.didExceedMatchLimit()) result.errors.push(`${filename}: injection query exceeded its match limit; coverage is incomplete`);
  for (const match of matches) {
    const kind = match.setProperties['gitlab_ci.kind'];
    const content = match.captures.find(c => c.name === 'injection.content').node;
    const key = `${kind}:${content.startIndex}:${content.endIndex}`;
    if (seen.has(key)) continue;
    seen.add(key);
    const parsed = parser.parse(source, null, { includedRanges: [range(content)] });
    inspect(parsed, kind);
    if (!parsed.rootNode.namedChildren.some(node => node.type === kind)) result.errors.push(`${filename}: expected ${kind} entry`);
    const conditions = parsed.rootNode.descendantsOfType('condition');
    result.rules += conditions.length;
    if (kind === 'template') result.interpolations += parsed.rootNode.descendantsOfType('interpolation').length;

    // GitLab evaluates decoded YAML values as well as their editor source text.
    const scalars = kind === 'template' ? [content] : conditions;
    for (const value of scalars) {
      if (!/^[\"'|>&]/.test(value.text)) continue;
      try {
        const decoded = YAML.parse(value.text);
        if (typeof decoded !== 'string') throw new Error('Expected a string scalar');
        const decodedTree = kind === 'template' ? parser.parse(decoded) : parseCondition(decoded);
        if (decodedTree.rootNode.hasError) result.errors.push(
          `${filename}:${value.startPosition.row + 1}: decoded ${kind}: invalid expression`);
      } catch (error) {
        result.errors.push(`${filename}:${value.startPosition.row + 1}: scalar decoding: ${error.message}`);
      }
    }

  }
  return result;
}

module.exports = { checkSource, parseCondition };
