const fs = require('node:fs');
const path = require('node:path');

// Prepare every file before replacement; restore originals if a rename fails.
function replaceFiles(root, files) {
  const stage = fs.mkdtempSync(path.join(root, '.reference-sync-'));
  const originals = new Set();
  const replaced = [];
  let keepBackups = false;
  try {
    for (const [file, content] of Object.entries(files)) {
      const staged = path.join(stage, 'new', file);
      const backup = path.join(stage, 'old', file);
      fs.mkdirSync(path.dirname(staged), { recursive: true });
      fs.mkdirSync(path.dirname(backup), { recursive: true });
      fs.writeFileSync(staged, content);
      try {
        fs.copyFileSync(path.join(root, file), backup);
        originals.add(file);
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    for (const file of Object.keys(files)) {
      fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      fs.renameSync(path.join(stage, 'new', file), path.join(root, file));
      replaced.push(file);
    }
  } catch (error) {
    const failures = [error];
    for (const file of replaced.reverse()) {
      try {
        if (originals.has(file)) fs.renameSync(path.join(stage, 'old', file), path.join(root, file));
        else fs.unlinkSync(path.join(root, file));
      } catch (rollbackError) {
        failures.push(rollbackError);
      }
    }
    if (failures.length > 1) {
      keepBackups = true;
      throw new AggregateError(failures, `Reference update failed and rollback was incomplete; backups retained at ${stage}`);
    }
    throw error;
  } finally {
    if (!keepBackups) fs.rmSync(stage, { recursive: true, force: true });
  }
}

module.exports = { replaceFiles };
