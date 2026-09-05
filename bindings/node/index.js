const binding = require('node-gyp-build')(require('node:path').join(__dirname, '../..'));
binding.nodeTypeInfo = require('../../src/node-types.json');
module.exports = binding;
