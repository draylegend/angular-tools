// Finds the Angular projects in a workspace, including nested ones, like the
// official VS Code client: every package.json outside node_modules that
// resolves or declares @angular/core. Run directly, it prints what the
// extension needs to know before it starts a server.
// Usage: node project.js <project root>
'use strict';

const fs = require('node:fs');
const path = require('node:path');

const SKIPPED = new Set(['node_modules', 'dist', 'build', 'out', 'target', 'coverage', 'tmp']);
const MAX_ENTRIES = 50000;

function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return undefined;
  }
}

function findManifests(root) {
  const manifests = [];
  const pending = [root];
  let entries = 0;
  while (pending.length && entries < MAX_ENTRIES) {
    const dir = pending.pop();
    let children;
    try {
      children = fs.readdirSync(dir, {withFileTypes: true});
    } catch {
      continue;
    }
    entries += children.length;
    for (const child of children) {
      if (child.isFile() && (child.name === 'package.json' || child.name === 'angular.json')) {
        manifests.push({dir, name: child.name});
      } else if (child.isDirectory() && !child.name.startsWith('.') && !SKIPPED.has(child.name)) {
        pending.push(path.join(dir, child.name));
      }
    }
  }
  return manifests;
}

// The installed package seen from a folder, looking up to the root.
function installedVersion(name, dir, root) {
  for (let current = dir; ; current = path.dirname(current)) {
    const version = readJson(path.join(current, 'node_modules', name, 'package.json'))?.version;
    if (version) return version;
    if (current === root || current === path.dirname(current)) return undefined;
  }
}

function declaredRange(name, manifest) {
  return manifest?.dependencies?.[name] ?? manifest?.devDependencies?.[name];
}

const versionNumbers = version => /\d+(\.\d+)*/.exec(version)?.[0].split('.').map(Number);

function compareVersions(a, b) {
  const [left, right] = [versionNumbers(a), versionNumbers(b)];
  for (let i = 0; i < 3; i++) {
    const difference = (left[i] ?? 0) - (right[i] ?? 0);
    if (difference) return difference;
  }
  return 0;
}

/**
 * The Angular folders of a workspace, the versions of Angular in them from the
 * oldest to the newest, and whether any package uses Tailwind.
 */
function inspect(root) {
  const dirs = new Set();
  const versions = new Set();
  let angular = false;
  let tailwind = false;
  for (const {dir, name} of findManifests(root)) {
    if (name === 'angular.json') {
      angular = true;
      dirs.add(dir);
      continue;
    }
    const manifest = readJson(path.join(dir, name));
    tailwind ||= declaredRange('tailwindcss', manifest) !== undefined;
    const range = declaredRange('@angular/core', manifest);
    const version = installedVersion('@angular/core', dir, root) ?? range;
    if (range === undefined && version === undefined) continue;
    angular = true;
    dirs.add(dir);
    if (version !== undefined && versionNumbers(version)) versions.add(version);
  }
  return {angular, dirs: [...dirs], tailwind, versions: [...versions].sort(compareVersions)};
}

/** Resolves a package from the project first, for a server or a tool to use. */
function resolvePackage(name, root, dirs) {
  return require.resolve(name, {paths: [root, ...dirs]});
}

module.exports = {inspect, resolvePackage, versionNumbers};

if (require.main === module) {
  const {angular, tailwind, versions} = inspect(process.argv[2]);
  const major = versions.length ? versionNumbers(versions.at(-1))[0] : null;
  process.stdout.write(JSON.stringify({angular, major, tailwind}));
}
