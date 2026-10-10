/**
 * The public certificates the repository publishes beside each installer:
 * the root that administrators import, and the signing certificate it
 * issued. A root that did not issue the signing certificate, or a signing
 * certificate not marked for code signing, would make the install notes
 * wrong and the signature worthless, so the chain is checked here, and the
 * root is confirmed to travel inside the installer.
 */
import { X509Certificate } from 'node:crypto';
import { readFileSync } from 'node:fs';

import { describe, expect, it } from 'vitest';

const read = (name) => new X509Certificate(readFileSync(new URL(`../${name}`, import.meta.url)));
const root = read('brand/corelens-root-ca.crt');
const signing = read('brand/corelens-desktop-codesign.crt');

describe('the published signing chain', () => {
  it('is a self-signed root that issued the signing certificate', () => {
    expect(root.ca).toBe(true);
    expect(root.checkIssued(root)).toBe(true);
    expect(root.verify(root.publicKey)).toBe(true);
    expect(signing.ca).toBe(false);
    expect(signing.checkIssued(root)).toBe(true);
    expect(signing.verify(root.publicKey)).toBe(true);
  });

  it('names the product, and the signing certificate is for code signing', () => {
    expect(root.subject).toContain('CN=corelens.us-Root-CA');
    expect(signing.subject).toContain('CN=corelens.us Code Signing');
    expect(signing.keyUsage).toContain('1.3.6.1.5.5.7.3.3'); // id-kp-codeSigning
  });

  it('is current, and outlives any release signed this year', () => {
    const now = Date.now();
    for (const cert of [root, signing]) {
      expect(new Date(cert.validFrom).getTime()).toBeLessThan(now);
      expect(new Date(cert.validTo).getTime()).toBeGreaterThan(now + 365 * 24 * 3600 * 1000);
    }
  });

  it('ships the root inside the installer, and the guide carries its thumbprint', () => {
    const conf = JSON.parse(readFileSync(new URL('../src-tauri/tauri.conf.json', import.meta.url), 'utf8'));
    expect(conf.bundle.resources['../brand/corelens-root-ca.crt']).toBe('corelens-root-ca.crt');
    const guide = readFileSync(new URL('../docs/INSTALL-WINDOWS.md', import.meta.url), 'utf8');
    expect(guide).toContain(root.fingerprint.replaceAll(':', ''));
  });
});
