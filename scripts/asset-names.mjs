#!/usr/bin/env node
/**
 * Release files under names a download URL can carry as they are.
 *
 * The bundler names installers after the product, "Corelens Desktop", and
 * GitHub rewrites a space in an uploaded file's name to a full stop. The
 * manifest the updater reads is written from the names on disk, so a space
 * left in would point every installed copy at a file that is not there.
 * Run after `tauri build` on each bundle folder:
 *
 *   node scripts/asset-names.mjs target/release/bundle/nsis target/release/bundle/msi
 *
 * Renames the files (not folders: a `.app` is not uploaded) directly inside
 * each folder, and prints what it renamed.
 */
import { existsSync, readdirSync, renameSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';

/** The name a release file is uploaded under: no spaces. */
export function assetName(name) {
  return name.replace(/\s+/g, '-');
}

if (process.argv[1] && basename(process.argv[1]) === 'asset-names.mjs') {
  for (const dir of process.argv.slice(2)) {
    if (!existsSync(dir)) continue;
    for (const name of readdirSync(dir)) {
      const from = join(dir, name);
      const to = assetName(name);
      if (to === name || !statSync(from).isFile()) continue;
      renameSync(from, join(dir, to));
      console.log(`${name} -> ${to}`);
    }
  }
}
