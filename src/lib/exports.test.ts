import { describe, expect, it } from 'vitest';

import { buildMarkdownReport, joinPath, slug } from './exports';

describe('joinPath', () => {
  it('joins a POSIX folder', () => {
    expect(joinPath('/home/me/exports', 'a.corelens')).toBe('/home/me/exports/a.corelens');
  });

  it('does not double the separator when the folder already ends with one', () => {
    expect(joinPath('/home/me/exports/', 'a.corelens')).toBe('/home/me/exports/a.corelens');
  });

  it('uses a backslash for a Windows folder', () => {
    // The picker returns native paths, and mixing separators produces a path
    // that looks right and does not exist.
    expect(joinPath('C:\\Users\\me\\Exports', 'a.corelens')).toBe('C:\\Users\\me\\Exports\\a.corelens');
    expect(joinPath('C:\\Users\\me\\Exports\\', 'a.corelens')).toBe('C:\\Users\\me\\Exports\\a.corelens');
  });

  it('treats a UNC path as a Windows path', () => {
    expect(joinPath('\\\\server\\share\\exports', 'a.corelens')).toBe(
      '\\\\server\\share\\exports\\a.corelens',
    );
  });
});

describe('slug', () => {
  it('makes a filename out of a project name', () => {
    expect(slug('Sample — Branch office validation')).toBe('sample-branch-office-validation');
  });

  it('never returns an empty name', () => {
    // An empty filename would produce a path ending in a separator.
    expect(slug('!!!')).toBe('project');
    expect(slug('')).toBe('project');
  });
});

describe('the Markdown report', () => {
  const meta = { id: 'p', name: 'Lab', customer: '', site: '', ticket: '', engineer: '', description: '', createdAt: 0, updatedAt: 0, archived: false };
  const base = { meta, events: [], counts: { healthy: 1, warning: 0, down: 0, unknown: 0, disabled: 0, maintenance: 0 }, nodeCount: 1, linkCount: 0, sessionStart: null, sessionEnd: null };

  it("embeds each page's drawing as an image in the one file", () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text>CORE-SW1 — é</text></svg>';
    const md = buildMarkdownReport({ ...base, diagrams: [{ name: 'Core', svg }, { name: 'Branch [2]', svg }] });
    expect(md).toContain('## Diagrams');
    expect(md).toContain('### Core');
    const images = [...md.matchAll(/!\[([^\]]*)\]\(data:image\/svg\+xml;base64,([A-Za-z0-9+/=]+)\)/g)];
    expect(images.map((m) => m[1])).toEqual(['Core', 'Branch  2 ']);
    const decoded = new TextDecoder().decode(Uint8Array.from(atob(images[0]![2]!), (c) => c.charCodeAt(0)));
    expect(decoded).toBe(svg);
  });

  it('leaves the section out when there is nothing to draw', () => {
    expect(buildMarkdownReport(base)).not.toContain('## Diagrams');
  });
});
