// Specialize only the path from YAML document entries to their mapping items.
// Hidden supertypes mark root pairs for queries; their visible nodes, fields,
// and nested values still come from the unmodified upstream productions.
module.exports = function rootContext(grammar) {
  const rules = grammar.rules;
  const clones = new Map();
  const added = {};
  const supertypes = [];
  function visit(node) {
    if (node.type === 'ALIAS' && !['block_node', 'flow_node', 'block_mapping', 'flow_mapping'].includes(node.value)) return node;
    if (node.type === 'SYMBOL' && /^_(?:(?:r|br|b)_blk_map_itm|(?:r|br)_flw_map_itm)$/.test(node.name)) {
      const name = '_ci_root' + node.name;
      if (!added[name]) { added[name] = node; supertypes.push(name); }
      return {type: 'SYMBOL', name};
    }
    if (node.type === 'SYMBOL' && rules[node.name]) {
      if (!clones.has(node.name)) {
        clones.set(node.name, node.name);
        const updated = visit(rules[node.name]);
        if (JSON.stringify(updated) !== JSON.stringify(rules[node.name])) {
          const name = '_ci_document' + node.name;
          added[name] = updated;
          clones.set(node.name, name);
        }
      }
      return {...node, name: clones.get(node.name)};
    }
    if (node.content) return {...node, content: visit(node.content)};
    if (node.members) return {...node, members: node.members.map(visit)};
    return node;
  }
  const entry = ['_bgn_imp_doc', '_imp_doc', '_exp_doc_tal'];
  const updatedEntries = Object.fromEntries(entry.map(name => [name, visit(rules[name])]));
  grammar.rules = {...rules, ...added, ...updatedEntries};
  grammar.supertypes = [...(grammar.supertypes || []), ...supertypes];
  grammar.inline = [...grammar.inline, ...grammar.inline.map(name => clones.get(name)).filter(name => name && name.startsWith('_ci_document'))];
};
