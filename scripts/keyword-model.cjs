const { schema: defaultSchema } = require('../data/keyword-schema.json');

// Paths retain sequence items and user-named dictionary entries. The strings
// "[]" and "*" never become literal YAML keywords.
function keywordRoutes(schema = defaultSchema) {
  const result = new Map();
  function visit(node, route, refs = []) {
    if (!node || typeof node !== 'object') return;
    if (node.$ref && !refs.includes(node.$ref)) {
      const target = node.$ref.split('/').slice(1).reduce((value, key) => value[key], schema);
      visit(target, route, [...refs, node.$ref]);
    }
    for (const [key, child] of Object.entries(node.properties || {})) {
      // This schema pseudo-property represents YAML tags in JSON validation.
      if (key === '!reference') continue;
      const next = [...route, key];
      result.set(JSON.stringify(next), next);
      visit(child, next, refs);
    }
    for (const child of Object.values(node.patternProperties || {})) visit(child, [...route, '*'], refs);
    if (typeof node.additionalProperties === 'object') visit(node.additionalProperties, [...route, '*'], refs);
    if (node.items) visit(node.items, [...route, '[]'], refs);
    for (const kind of ['allOf', 'anyOf', 'oneOf']) for (const child of node[kind] || []) visit(child, route, refs);
    for (const kind of ['then', 'else']) if (node[kind]) visit(node[kind], route, refs);
  }
  // Root `pages` is a job name in the schema, not a global keyword.
  const root = { ...schema, properties: { ...schema.properties } };
  delete root.properties.pages;
  delete root.patternProperties;
  delete root.additionalProperties;
  visit(root, []);
  visit(schema.definitions.job_template, ['*']);
  return [...result.values()].sort((a, b) => a.join('/').localeCompare(b.join('/')));
}

function canonicalPath(route) {
  return route.filter(key => key !== '*' && key !== '[]').join(':');
}

module.exports = { keywordRoutes, canonicalPath };
