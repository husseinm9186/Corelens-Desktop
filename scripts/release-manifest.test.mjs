/**
 * The release manifest: the right files picked, the manifest the updater
 * reads shaped as it expects, the version's notes cut from the release
 * notes, and a signature's trusted comment read back.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import { assetName } from './asset-names.mjs';
import { checksums, manifest, notesFor, pickArtifacts, trustedComment } from './release-manifest.mjs';

const NAMES = [
  'Corelens-Desktop_2.9.0_x64-setup.exe',
  'Corelens-Desktop_2.9.0_x64-setup.exe.sig',
  'SHA256SUMS.txt',
  'corelens-rust.cdx.json',
  'corelens-root-ca.crt',
  'corelens-desktop-codesign.crt',
  'Corelens-Desktop_2.9.0_universal.dmg',
  'Corelens-Desktop.app.tar.gz',
  'Corelens-Desktop.app.tar.gz.sig',
];

describe('pickArtifacts', () => {
  it('finds each installer, its signature and the extras worth attaching', () => {
    const picked = pickArtifacts(NAMES);
    expect(picked.windows).toBe('Corelens-Desktop_2.9.0_x64-setup.exe');
    expect(picked.windowsSig).toBe('Corelens-Desktop_2.9.0_x64-setup.exe.sig');
    expect(picked.mac).toBe('Corelens-Desktop.app.tar.gz');
    expect(picked.macSig).toBe('Corelens-Desktop.app.tar.gz.sig');
    expect(picked.dmg).toBe('Corelens-Desktop_2.9.0_universal.dmg');
    // One job's own checksum file covers that job's installer alone; the
    // release carries one written over everything a person downloads.
    expect(picked.extras).toEqual(['corelens-rust.cdx.json', 'corelens-root-ca.crt', 'corelens-desktop-codesign.crt']);
  });

  it('refuses a release the app could not verify', () => {
    expect(() => pickArtifacts(NAMES.filter((n) => !n.endsWith('.sig')))).toThrow(/signature/);
    expect(() => pickArtifacts(NAMES.filter((n) => !n.endsWith('.dmg')))).toThrow(/disk image/);
    expect(() => pickArtifacts([...NAMES, 'Corelens-Desktop_2.9.1_x64-setup.exe'])).toThrow(/Windows installer/);
  });

  // The bundler names files after the product, which has a space; GitHub
  // would upload them under another name than the manifest's URL.
  it('refuses a file name with a space, and the rename takes the space out', () => {
    const spaced = NAMES.map((n) => n.replace('Corelens-Desktop', 'Corelens Desktop'));
    expect(() => pickArtifacts(spaced)).toThrow(/space/);
    expect(pickArtifacts(spaced.map(assetName)).windows).toBe('Corelens-Desktop_2.9.0_x64-setup.exe');
    expect(assetName('Corelens Desktop.app.tar.gz.sig')).toBe('Corelens-Desktop.app.tar.gz.sig');
  });
});

describe('manifest', () => {
  const picked = pickArtifacts(NAMES);
  const made = manifest({
    version: '2.9.0',
    repo: 'owner/name',
    picked,
    signatures: { windows: 'dW50cnVzdGVk', mac: 'bWFj' },
    notes: 'Fixes.\n',
    date: '2026-10-09T12:00:00Z',
  });

  it('points every platform at the tagged release on GitHub, with its signature', () => {
    expect(made.version).toBe('2.9.0');
    expect(made.pub_date).toBe('2026-10-09T12:00:00Z');
    expect(made.notes).toBe('Fixes.\n');
    expect(made.platforms['windows-x86_64']).toEqual({
      signature: 'dW50cnVzdGVk',
      url: 'https://github.com/owner/name/releases/download/v2.9.0/Corelens-Desktop_2.9.0_x64-setup.exe',
    });
    // The universal archive serves both Mac targets.
    expect(made.platforms['darwin-aarch64']).toEqual({
      signature: 'bWFj',
      url: 'https://github.com/owner/name/releases/download/v2.9.0/Corelens-Desktop.app.tar.gz',
    });
    expect(made.platforms['darwin-x86_64']).toEqual(made.platforms['darwin-aarch64']);
    expect(Object.keys(made.platforms)).toHaveLength(3);
  });

  it('refuses anything but a release version', () => {
    expect(() => manifest({ version: 'v2.9.0', repo: 'o/n', picked, signatures: { windows: 'a', mac: 'b' }, notes: '', date: '' })).toThrow(/not a release version/);
  });
});

describe('notesFor', () => {
  const NOTES = `# Release notes

Newest first.

## 2.9.1 — 2026-10-20

**Fixes**
- One.

## 2.9.0 — 2026-10-09

**Updates**
- The app can check GitHub.

## 2.8.0 — 2026-10-09

**Backups**
- Over SNMP.
`;

  it('cuts the version\'s own section, without its heading', () => {
    expect(notesFor(NOTES, '2.9.0')).toBe('**Updates**\n- The app can check GitHub.\n');
    expect(notesFor(NOTES, '2.9.1')).toBe('**Fixes**\n- One.\n');
    // The oldest section runs to the end of the file.
    expect(notesFor(NOTES, '2.8.0')).toBe('**Backups**\n- Over SNMP.\n');
  });

  it('says when the notes have no section for the version', () => {
    expect(() => notesFor(NOTES, '2.10.0')).toThrow(/no section for 2\.10\.0/);
    // 2.9.0 must not match 2.9.0's neighbour by prefix.
    expect(() => notesFor(NOTES.replace('## 2.9.0', '## 2.9.01'), '2.9.0')).toThrow();
  });
});

describe('trustedComment', () => {
  it('reads what a minisign signature says it signed', () => {
    const sig = Buffer.from(
      'untrusted comment: signature from tauri secret key\nRUSv…\ntrusted comment: timestamp:1791601794\tfile:sigtest.bin\n3YPk…\n',
    ).toString('base64');
    expect(trustedComment(sig)).toBe('timestamp:1791601794\tfile:sigtest.bin');
    expect(trustedComment(Buffer.from('nothing here').toString('base64'))).toBe('');
  });
});

describe('checksums', () => {
  it('is a line per file a person downloads, as sha256sum writes and reads them', () => {
    const files = [
      { name: 'b-setup.exe', bytes: Buffer.from('windows') },
      { name: 'a.dmg', bytes: Buffer.from('mac') },
    ];
    const sha = (text) => createHash('sha256').update(text).digest('hex');
    expect(checksums(files)).toBe(`${sha('windows')}  b-setup.exe\n${sha('mac')}  a.dmg\n`);
  });

  it('is written by the command for every installer, and listed for attaching', () => {
    const dir = mkdtempSync(join(tmpdir(), 'manifest-'));
    const dl = join(dir, 'dl');
    mkdirSync(join(dl, 'windows'), { recursive: true });
    mkdirSync(join(dl, 'mac'));
    const version = readFileSync(new URL('../docs/RELEASE-NOTES.md', import.meta.url), 'utf8').match(/^## (\d+\.\d+\.\d+)/m)[1];
    const sig = Buffer.from('untrusted comment: x\nAAAA\ntrusted comment: file:x\nBBBB\n').toString('base64');
    writeFileSync(join(dl, 'windows', 'App_x64-setup.exe'), 'windows installer');
    writeFileSync(join(dl, 'windows', 'App_x64-setup.exe.sig'), sig);
    // The Windows job's own file: superseded, not attached beside the new one.
    writeFileSync(join(dl, 'windows', 'SHA256SUMS.txt'), 'stale  App_x64-setup.exe\n');
    writeFileSync(join(dl, 'mac', 'App_universal.dmg'), 'disk image');
    writeFileSync(join(dl, 'mac', 'App.app.tar.gz'), 'update archive');
    writeFileSync(join(dl, 'mac', 'App.app.tar.gz.sig'), sig);
    const out = join(dir, 'release');
    const printed = execFileSync(process.execPath, [fileURLToPath(new URL('./release-manifest.mjs', import.meta.url)), '--version', version, '--artifacts', dl, '--repo', 'owner/name', '--out', out], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n');
    const sums = readFileSync(join(out, 'SHA256SUMS.txt'), 'utf8');
    const sha = (text) => createHash('sha256').update(text).digest('hex');
    expect(sums).toBe(`${sha('windows installer')}  App_x64-setup.exe\n${sha('disk image')}  App_universal.dmg\n${sha('update archive')}  App.app.tar.gz\n`);
    expect(printed).toContain(join(out, 'SHA256SUMS.txt'));
    expect(printed.filter((p) => p.endsWith('SHA256SUMS.txt'))).toHaveLength(1);
  });
});
