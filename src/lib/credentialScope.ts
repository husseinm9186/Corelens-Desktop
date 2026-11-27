/**
 * Which saved credentials belong to the project in front of you.
 *
 * The vault is one encrypted store per machine and that is deliberate: the key
 * is derived from one passphrase, held once, and zeroed on lock. Every
 * project on the machine shares it.
 *
 * What must **not** be shared is the view. Opening project B and seeing the
 * logins project A saved is a leak — not of the
 * secrets, which never leave the vault, but of the fact that they exist, their
 * labels and their usernames. A project should show its own.
 *
 * "Its own" is derivable and needs no new storage: a credential belongs to a
 * project when the project refers to it — as its global SSH or SNMP login, or
 * on one of its devices. Everything here is pure.
 */
import { allNodes } from './pages';
import type { ProjectDocument } from '../state/store';
import type { DeviceNodeData } from '../types/domain';

/** Every credential id this project refers to, anywhere. */
export function credentialsUsedBy(doc: Pick<ProjectDocument, 'pages' | 'credentialDefaults' | 'credentialRules'> & Partial<Pick<ProjectDocument, 'probes' | 'crawlProfiles'>>): Set<string> {
  const used = new Set<string>();
  const add = (id: string | undefined | null) => {
    const t = id?.trim();
    if (t) used.add(t);
  };
  add(doc.credentialDefaults?.ssh);
  for (const id of doc.credentialDefaults?.sshMore ?? []) add(id);
  for (const id of doc.credentialDefaults?.snmp ?? []) add(id);
  for (const rule of doc.credentialRules ?? []) add(rule.credentialId);
  // A check over SNMP and a saved discovery profile each name a login too.
  for (const probe of doc.probes ?? []) add(probe.snmpCredentialId);
  for (const profile of doc.crawlProfiles ?? []) add(profile.credentialId);
  for (const node of allNodes(doc)) {
    if (node.type !== 'device') continue;
    const d = node.data as DeviceNodeData;
    add(d.sshCredentialId);
    add(d.snmpCredentialId);
  }
  return used;
}

/**
 * The references this project holds that the vault no longer has.
 *
 * A project stores ids and the vault outlives any one project, so an id goes
 * stale whenever a credential is wiped — or whenever the project is opened on
 * a different machine, whose vault never had it. Neither is an error; both
 * used to be, loudly and in the wrong place ("That saved credential no longer
 * exists", on a crawl that had nothing to do with it).
 */
export function staleCredentials(doc: ProjectDocument, inVault: { id: string }[]): string[] {
  const have = new Set(inVault.map((c) => c.id));
  return [...credentialsUsedBy(doc)].filter((id) => !have.has(id)).sort();
}

/**
 * The document with every stale reference removed.
 *
 * Returns `null` when there was nothing to do, so a caller can avoid marking a
 * project dirty — and avoid an endless loop — just for looking at it.
 */
export function withoutStaleCredentials(
  doc: ProjectDocument,
  inVault: { id: string }[],
): ProjectDocument | null {
  const stale = new Set(staleCredentials(doc, inVault));
  if (stale.size === 0) return null;

  const defaults = doc.credentialDefaults;
  const nextDefaults = defaults
    ? {
        ...defaults,
        ssh: defaults.ssh && stale.has(defaults.ssh) ? undefined : defaults.ssh,
        ...(defaults.sshMore ? { sshMore: defaults.sshMore.filter((id) => !stale.has(id)) } : {}),
        snmp: (defaults.snmp ?? []).filter((id) => !stale.has(id)),
      }
    : undefined;

  return {
    ...doc,
    credentialDefaults: nextDefaults,
    credentialRules: (doc.credentialRules ?? []).filter((r) => !stale.has(r.credentialId)),
    probes: doc.probes.some((p) => stale.has(p.snmpCredentialId ?? '')) ? doc.probes.map((p) => (stale.has(p.snmpCredentialId ?? '') ? { ...p, snmpCredentialId: null } : p)) : doc.probes,
    ...(doc.crawlProfiles?.some((p) => stale.has(p.credentialId ?? ''))
      ? { crawlProfiles: doc.crawlProfiles.map((p) => (stale.has(p.credentialId ?? '') ? { ...p, credentialId: null } : p)) }
      : {}),
    pages: doc.pages.map((page) => ({
      ...page,
      nodes: page.nodes.map((node) => {
        if (node.type !== 'device') return node;
        const d = node.data as DeviceNodeData;
        if (!stale.has(d.sshCredentialId ?? '') && !stale.has(d.snmpCredentialId ?? '')) return node;
        return {
          ...node,
          data: {
            ...d,
            sshCredentialId: stale.has(d.sshCredentialId ?? '') ? undefined : d.sshCredentialId,
            snmpCredentialId: stale.has(d.snmpCredentialId ?? '') ? undefined : d.snmpCredentialId,
          },
        };
      }),
    })),
  };
}

/**
 * The document with its references to imported logins pointed at the ids
 * they were given here. An import re-seals each login under a fresh id (one
 * from another machine's vault may share an id with one of this vault's),
 * and answers with exported id → new id; without this the project's own
 * logins, its devices' and its rules would name ids this vault never had,
 * and be forgotten as stale the next time they were looked at.
 *
 * Returns `doc` itself when nothing it refers to was moved.
 */
export function withCredentialIds(doc: ProjectDocument, ids: Record<string, string>): ProjectDocument {
  const moved = (id: string | undefined) => (id !== undefined && Object.hasOwn(ids, id) ? ids[id] : id);
  if (![...credentialsUsedBy(doc)].some((id) => Object.hasOwn(ids, id))) return doc;
  const defaults = doc.credentialDefaults;
  return {
    ...doc,
    credentialDefaults: defaults
      ? {
          ...defaults,
          ssh: moved(defaults.ssh),
          ...(defaults.sshMore ? { sshMore: defaults.sshMore.map((id) => moved(id) ?? id) } : {}),
          ...(defaults.snmp ? { snmp: defaults.snmp.map((id) => moved(id) ?? id) } : {}),
        }
      : defaults,
    ...(doc.credentialRules ? { credentialRules: doc.credentialRules.map((r) => ({ ...r, credentialId: moved(r.credentialId) ?? r.credentialId })) } : {}),
    probes: doc.probes.map((p) => (p.snmpCredentialId && moved(p.snmpCredentialId) !== p.snmpCredentialId ? { ...p, snmpCredentialId: moved(p.snmpCredentialId) } : p)),
    ...(doc.crawlProfiles
      ? { crawlProfiles: doc.crawlProfiles.map((p) => (p.credentialId && moved(p.credentialId) !== p.credentialId ? { ...p, credentialId: moved(p.credentialId) ?? null } : p)) }
      : {}),
    pages: doc.pages.map((page) => ({
      ...page,
      nodes: page.nodes.map((node) => {
        if (node.type !== 'device') return node;
        const d = node.data as DeviceNodeData;
        const ssh = moved(d.sshCredentialId);
        const snmp = moved(d.snmpCredentialId);
        if (ssh === d.sshCredentialId && snmp === d.snmpCredentialId) return node;
        return { ...node, data: { ...d, sshCredentialId: ssh, snmpCredentialId: snmp } };
      }),
    })),
  };
}
