const { existsSync } = require('node:fs');
const { execFileSync } = require('node:child_process');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
// Mise explicitly skips this hook until it has generated the parsers.
if (!process.env.GITLAB_CI_SKIP_BUILD) {
  if (!existsSync(path.join(root, 'src/parser.c'))) {
    throw new Error('Missing generated parser source: src/parser.c. Run mise run generate in a source checkout, or reinstall a complete package.');
  }
  execFileSync('node-gyp-build', [], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' });
}
