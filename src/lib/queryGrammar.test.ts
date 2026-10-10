import { describe, expect, it } from 'vitest';

import { dockRowMatches, parseDockQuery } from './dockQuery';
import { matchesQuery, plainText, splitQuery } from './queryGrammar';
import { parseFilter } from './ipamFilter';

const fields = (name: string) => (['tag', 'status'].includes(name) ? name : null);

describe('the shared grammar', () => {
  it('splits words, fields, negation and quotes', () => {
    expect(splitQuery('core tag:pci -status:down name:"core sw"', (n) => (['tag', 'status', 'name'].includes(n) ? n : null))).toEqual([
      { field: null, value: 'core', negated: false },
      { field: 'tag', value: 'pci', negated: false },
      { field: 'status', value: 'down', negated: true },
      { field: 'name', value: 'core sw', negated: false },
    ]);
  });

  it('searches an unknown field as text rather than refusing it', () => {
    expect(splitQuery('printer:2f', fields)).toEqual([{ field: null, value: 'printer:2f', negated: false }]);
  });

  it('needs every term, and a negated one excludes', () => {
    const subject = { text: 'core switch', values: (f: string) => (f === 'tag' ? ['lab'] : []), exact: () => true };
    expect(matchesQuery(splitQuery('core', fields), subject)).toBe(true);
    expect(matchesQuery(splitQuery('core tag:lab', fields), subject)).toBe(true);
    expect(matchesQuery(splitQuery('core -tag:lab', fields), subject)).toBe(false);
    expect(matchesQuery(splitQuery('core router', fields), subject)).toBe(false);
  });

  it('keeps the plain words for ranking', () => {
    expect(plainText(splitQuery('core -old tag:x sw', fields))).toBe('core sw');
  });

  it('is the register\'s grammar too', () => {
    expect(parseFilter('core -tag:old vlan:14')).toEqual(splitQuery('core -tag:old vlan:14', (n) => (['tag', 'vlan'].includes(n) ? n : null)));
  });
});

describe('the dock\'s lists', () => {
  const row = { kind: 'node' as const, name: 'CORE-SW1', target: '192.0.2.10', type: 'core-switch', status: 'down' as const, tags: ['lab'], site: 'HQ' };
  const m = (q: string) => dockRowMatches(row, parseDockQuery(q));

  it('still finds a bare word anywhere', () => {
    expect(m('core')).toBe(true);
    expect(m('192.0.2')).toBe(true);
    expect(m('down')).toBe(true);
    expect(m('router')).toBe(false);
  });

  it('narrows by status, type, tag, site and kind', () => {
    expect(m('status:down')).toBe(true);
    expect(m('status:up')).toBe(false);
    expect(m('type:switch')).toBe(true);
    expect(m('tag:lab')).toBe(true);
    expect(m('tag:la')).toBe(false);
    expect(m('site:hq')).toBe(true);
    expect(m('kind:device')).toBe(true);
    expect(m('kind:link')).toBe(false);
  });

  it('answers to the word shown as well as the one stored', () => {
    expect(dockRowMatches({ ...row, status: 'healthy' }, parseDockQuery('status:up'))).toBe(true);
    expect(dockRowMatches({ ...row, status: 'unknown' }, parseDockQuery('status:not-checked'))).toBe(true);
  });

  it('excludes with a minus', () => {
    expect(m('-tag:lab')).toBe(false);
    expect(m('core -status:up')).toBe(true);
  });
});

describe('the palette', () => {
  it('narrows its fuzzy search with the same grammar', async () => {
    const { search } = await import('./search');
    const index = [
      { kind: 'device' as const, text: 'CORE-SW1', detail: '', type: 'core-switch', tags: ['lab'] },
      { kind: 'device' as const, text: 'CORE-RTR1', detail: '', type: 'router', tags: [] },
      { kind: 'address' as const, text: '192.0.2.10', detail: 'CORE-SW1 Mgmt' },
    ];
    expect(search(index, 'core').map((i) => i.text).sort()).toEqual(['CORE-RTR1', 'CORE-SW1']);
    expect(search(index, 'core type:router').map((i) => i.text)).toEqual(['CORE-RTR1']);
    expect(search(index, 'core -tag:lab').map((i) => i.text)).toEqual(['CORE-RTR1']);
    expect(search(index, 'kind:address').map((i) => i.text)).toEqual(['192.0.2.10']);
    // A MAC or an IPv6 address is not mistaken for a field.
    expect(search([{ kind: 'mac', text: '00:00:5e:00:53:01', detail: '' }], '00:00:5e').length).toBe(1);
  });
});
