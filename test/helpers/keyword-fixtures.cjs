// Build YAML independently of the query renderer. The final key always has a
// unique marker value, allowing us to verify its exact capture range.
function fixture(route, mode, quote, depth = 0) {
  if (!route.length) return 'coverage_probe';
  const [part, ...rest] = route;
  const flow = mode === 'flow' || (mode === 'mixed' && depth % 2 === 1);
  // Flow collections require their complete subtree to be flow-style.
  const value = fixture(rest, flow ? 'flow' : mode, quote, depth + 1);
  const indent = value.replaceAll('\n', '\n  ');
  if (part === '[]') return flow ? `[${value}]` : `- ${indent}`;
  const key = quote + (part === '*' ? (depth ? 'user_key' : 'example_job') : part) + quote;
  if (flow) return `{${key}: ${value}}`;
  return value.includes('\n') || rest.length ? `${key}:\n  ${indent}` : `${key}: ${value}`;
}

module.exports = { fixture };
