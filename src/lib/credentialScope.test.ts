import { describe, expect, it } from 'vitest';

import { credentialsUsedBy, staleCredentials, withCredentialIds, withoutStaleCredentials } from './credentialScope';
import type { ProjectDocument } from '../state/store';

const device = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  type: 'device' as const,
  position: { x: 0, y: 0 },
  data: { label: id, deviceType: 'access-switch', tags: [], ...over },
});

const doc = (over: Partial<ProjectDocument> = {}): ProjectDocument =>
  ({
    activePageId: 'p1',
    probes: [],
    pages: [{ id: 'p1', name: 'Core', canvas: {}, edges: [], nodes: [] }],
    ...over,
  }) as unknown as ProjectDocument;

describe('which credentials a project refers to', () => {
  it('finds the project login, the rules and every device', () => {
    const d = doc({
      credentialDefaults: { ssh: 'a', snmp: ['b', 'c'] },
      credentialRules: [{ id: 'r1', scope: 'subnet', value: '192.0.2.0/24', credentialId: 'd' }],
      pages: [
        {
          id: 'p1',
          name: 'Core',
          canvas: {},
          edges: [],
          nodes: [device('sw', { sshCredentialId: 'e', snmpCredentialId: 'f' }), device('bare')],
        },
      ],
    } as unknown as Partial<ProjectDocument>);
    expect([...credentialsUsedBy(d)].sort()).toEqual(['a', 'b', 'c', 'd', 'e', 'f']);
  });

  it('ignores blank and whitespace-only references', () => {
    const d = doc({ credentialDefaults: { ssh: '   ', snmp: [''] } } as Partial<ProjectDocument>);
    expect(credentialsUsedBy(d).size).toBe(0);
  });

  it('is empty for a project that has never saved one', () => {
    expect(credentialsUsedBy(doc()).size).toBe(0);
  });
});

describe('references the vault no longer has', () => {
  const d = doc({
    credentialDefaults: { ssh: 'gone', snmp: ['here', 'also-gone'] },
    pages: [
      {
        id: 'p1',
        name: 'Core',
        canvas: {},
        edges: [],
        nodes: [device('sw', { sshCredentialId: 'gone', snmpCredentialId: 'here' })],
      },
    ],
  } as unknown as Partial<ProjectDocument>);
  const vault = [{ id: 'here' }];

  it('names them, and only them', () => {
    expect(staleCredentials(d, vault)).toEqual(['also-gone', 'gone']);
  });

  it('takes them out of every place they are held', () => {
    const cleaned = withoutStaleCredentials(d, vault);
    expect(cleaned).toBeTruthy();
    expect(cleaned!.credentialDefaults?.ssh).toBeUndefined();
    expect(cleaned!.credentialDefaults?.snmp).toEqual(['here']);
    const node = cleaned!.pages[0]!.nodes[0]!;
    expect((node.data as { sshCredentialId?: string }).sshCredentialId).toBeUndefined();
    // And leaves alone the one that is still there.
    expect((node.data as { snmpCredentialId?: string }).snmpCredentialId).toBe('here');
  });

  it('says there is nothing to do rather than making a new document', () => {
    // Otherwise looking at a healthy project marks it dirty on every render,
    // which is an endless loop dressed as a feature.
    expect(withoutStaleCredentials(doc({ credentialDefaults: { ssh: 'here' } } as Partial<ProjectDocument>), vault))
      .toBeNull();
    expect(withoutStaleCredentials(doc(), [])).toBeNull();
  });

  it('a project opened on a machine with an empty vault loses every reference', () => {
    // Not an error: the vault is per machine, and the project travelled.
    const cleaned = withoutStaleCredentials(d, []);
    expect(cleaned!.credentialDefaults?.ssh).toBeUndefined();
    expect(cleaned!.credentialDefaults?.snmp).toEqual([]);
    expect(credentialsUsedBy(cleaned!).size).toBe(0);
  });
});

describe('logins brought in under new ids', () => {
  const before = doc({
    credentialDefaults: { ssh: 'a', sshMore: ['b', 'keep'], snmp: ['c'] },
    credentialRules: [{ id: 'r1', scope: 'subnet', value: '192.0.2.0/24', credentialId: 'a' }],
    pages: [{ id: 'p1', name: 'Core', canvas: {}, edges: [], nodes: [device('sw', { sshCredentialId: 'b', snmpCredentialId: 'c' }), device('bare')] }],
  } as unknown as Partial<ProjectDocument>);
  const ids = { a: 'A2', b: 'B2', c: 'C2' };

  it('points every reference at the id the login has here', () => {
    const after = withCredentialIds(before, ids);
    expect(after.credentialDefaults).toEqual({ ssh: 'A2', sshMore: ['B2', 'keep'], snmp: ['C2'] });
    expect(after.credentialRules?.[0]?.credentialId).toBe('A2');
    const sw = after.pages[0]!.nodes[0]!.data as { sshCredentialId?: string; snmpCredentialId?: string };
    expect([sw.sshCredentialId, sw.snmpCredentialId]).toEqual(['B2', 'C2']);
    expect(after.pages[0]!.nodes[1]).toBe(before.pages[0]!.nodes[1]);
  });

  it('leaves a document with nothing to move as it was', () => {
    expect(withCredentialIds(before, {})).toBe(before);
  });
});

describe('a further SSH login gone from the vault', () => {
  it('is dropped with the rest, not left showing as a question mark', () => {
    const d = doc({ credentialDefaults: { ssh: 'a', sshMore: ['gone', 'b'] } } as unknown as Partial<ProjectDocument>);
    expect(staleCredentials(d, [{ id: 'a' }, { id: 'b' }])).toEqual(['gone']);
    expect(withoutStaleCredentials(d, [{ id: 'a' }, { id: 'b' }])?.credentialDefaults?.sshMore).toEqual(['b']);
  });
});

describe('every holder of a login id, not only devices', () => {
  // A check over SNMP names its login, and so does a saved discovery
  // profile; both are part of the project and travel with it.
  const before = doc({
    probes: [{ id: 'pr1', kind: 'snmp', snmpCredentialId: 'c' }, { id: 'pr2', kind: 'icmp' }],
    crawlProfiles: [{ id: 'cp1', name: 'Site', credentialId: 'a' }],
    pages: [{ id: 'p1', name: 'Core', canvas: {}, edges: [], nodes: [] }],
  } as unknown as Partial<ProjectDocument>);

  it('counts as used, so it is exported with the project', () => {
    expect([...credentialsUsedBy(before)].sort()).toEqual(['a', 'c']);
  });

  it('follows an imported login to its new id', () => {
    const after = withCredentialIds(before, { a: 'A2', c: 'C2' });
    expect((after.probes[0] as { snmpCredentialId?: string }).snmpCredentialId).toBe('C2');
    expect(after.probes[1]).toBe(before.probes[1]);
    expect((after.crawlProfiles![0] as { credentialId?: string | null }).credentialId).toBe('A2');
  });

  it('and is forgotten with the rest when the vault no longer has it', () => {
    expect(staleCredentials(before, [{ id: 'a' }])).toEqual(['c']);
    const after = withoutStaleCredentials(before, [{ id: 'a' }])!;
    expect((after.probes[0] as { snmpCredentialId?: string | null }).snmpCredentialId ?? null).toBeNull();
    expect((after.crawlProfiles![0] as { credentialId?: string | null }).credentialId).toBe('a');
    expect(withoutStaleCredentials(after, [{ id: 'a' }])).toBeNull();
  });
});
