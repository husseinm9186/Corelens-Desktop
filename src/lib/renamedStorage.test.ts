import { describe, expect, it } from 'vitest';

import { adoptRenamedKeys } from './renamedStorage';

function memory(entries: Record<string, string>): Storage {
  const map = new Map(Object.entries(entries));
  return {
    get length() { return map.size; },
    key: (i: number) => [...map.keys()][i] ?? null,
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    clear: () => map.clear(),
  };
}

describe('storage kept under the earlier name', () => {
  it('moves every key across, view settings, recovery copies and projects alike', () => {
    const s = memory({
      'coreview.view.uiScale': '1.25',
      'coreview.recovery.p1': '{"doc":1}',
      'coreview.projects.v1': '{"p1":{}}',
      'unrelated': 'kept',
    });
    expect(adoptRenamedKeys(s)).toBe(3);
    expect(s.getItem('corelens.view.uiScale')).toBe('1.25');
    expect(s.getItem('corelens.recovery.p1')).toBe('{"doc":1}');
    expect(s.getItem('corelens.projects.v1')).toBe('{"p1":{}}');
    expect(s.getItem('coreview.view.uiScale')).toBeNull();
    expect(s.getItem('unrelated')).toBe('kept');
  });

  it('never overwrites what the current name already holds, and does not bring back a cleared key', () => {
    const s = memory({ 'coreview.view.uiScale': '1.25', 'corelens.view.uiScale': '1.5' });
    expect(adoptRenamedKeys(s)).toBe(0);
    expect(s.getItem('corelens.view.uiScale')).toBe('1.5');
    s.removeItem('corelens.view.uiScale');
    expect(adoptRenamedKeys(s)).toBe(0);
    expect(s.getItem('corelens.view.uiScale')).toBeNull();
  });
});
