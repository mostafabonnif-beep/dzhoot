import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(new URL('.', import.meta.url).pathname, '..');
const expected = {
  'package.json': 'dzhoof-iptv',
  'backend/package.json': '@dzhoof/backend',
  'frontend/package.json': '@dzhoof/frontend',
  'packages/shared/package.json': '@dzhoof/shared',
};

const failures = [];
for (const [relative, expectedName] of Object.entries(expected)) {
  const file = path.join(root, relative);
  if (!fs.existsSync(file)) {
    failures.push(`${relative}: file is missing`);
    continue;
  }
  const pkg = JSON.parse(fs.readFileSync(file, 'utf8'));
  if (pkg.name !== expectedName) {
    failures.push(`${relative}: expected name ${expectedName}, found ${pkg.name}`);
  }
  const content = fs.readFileSync(file, 'utf8');
  if (content.includes('@firevision/')) {
    failures.push(`${relative}: contains @firevision/`);
  }
}

const lockfile = path.join(root, 'package-lock.json');
if (fs.existsSync(lockfile) && fs.readFileSync(lockfile, 'utf8').includes('@firevision/')) {
  failures.push('package-lock.json: contains @firevision/');
}

if (failures.length) {
  console.error('Workspace scope check failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log('Workspace scope check passed: @dzhoof/* is the only active internal package namespace.');
