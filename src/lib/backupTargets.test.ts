import { describe, expect, it } from 'vitest';
import { diagramTargets } from './backupTargets';

const at = (address: string, over = {}) => ({ label: 'EXAMPLE-SW', addresses: [{ address, isPrimary: true }], ...over });

describe('what a backup is taken of', () => {
  it('lists a device drawn on two pages once', () => {
    // Both pages' nodes, as the panel hands them over.
    const targets = diagramTargets([at('192.0.2.10'), at('192.0.2.11', { label: 'OTHER' }), at('192.0.2.10')], [], '');
    expect(targets.map((t) => t.address)).toEqual(['192.0.2.10', '192.0.2.11']);
  });

  it('treats the same address with stray spaces as the same device', () => {
    expect(diagramTargets([at('192.0.2.10'), at(' 192.0.2.10 ')], [], '')).toHaveLength(1);
  });

  it('keeps what each drawing adds: commands, tags, a role', () => {
    const t = diagramTargets(
      [at('192.0.2.10', { showCommands: 'show clock', tags: ['core'] }), at('192.0.2.10', { showCommands: 'show clock\nshow users', tags: ['edge'], role: 'core' })],
      [],
      'HQ',
    )[0]!;
    expect(t.commands).toEqual(['show clock', 'show users']);
    expect(t.own).toBe(2);
    expect(t.tags).toEqual(['core', 'edge']);
    expect(t.role).toBe('core');
    expect(t.site).toBe('HQ');
  });

  it('leaves out a device with no address', () => {
    expect(diagramTargets([{ label: 'x', addresses: [] }], [], '')).toEqual([]);
  });
});
