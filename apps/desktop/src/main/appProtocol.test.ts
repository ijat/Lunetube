import { sep } from 'node:path';
import { describe, expect, it, vi } from 'vitest';

// The module imports `electron` at top level for `protocol.*`; the pure mapping
// under test never touches it.
vi.mock('electron', () => ({
  protocol: { registerSchemesAsPrivileged: vi.fn(), handle: vi.fn() },
}));

const { resolveAssetPath } = await import('./appProtocol.js');

const DIR = sep === '/' ? '/app/out/renderer' : 'C:\\app\\out\\renderer';
const inside = (p: string) => `${DIR}${sep}${p.split('/').join(sep)}`;

describe('resolveAssetPath', () => {
  it('maps the bare origin to index.html', () => {
    expect(resolveAssetPath(DIR, 'app://bundle/')).toEqual({
      filePath: inside('index.html'),
      ext: '.html',
    });
  });

  it('maps a nested asset and lower-cases its extension', () => {
    expect(resolveAssetPath(DIR, 'app://bundle/assets/main.CSS')).toEqual({
      filePath: inside('assets/main.CSS'),
      ext: '.css',
    });
  });

  it('reports no extension for an extensionless path', () => {
    expect(resolveAssetPath(DIR, 'app://bundle/watch/abc123')?.ext).toBe('');
  });

  it.each([
    'app://bundle/../etc/passwd',
    'app://bundle/..%2f..%2fetc%2fpasswd',
    'app://bundle/%2e%2e/%2e%2e/secret',
    'app://bundle/....//....//x',
  ])('contains traversal attempt %s within rendererDir', (url) => {
    const r = resolveAssetPath(DIR, url);
    expect(r).not.toBeNull();
    expect(r?.filePath === DIR || r!.filePath.startsWith(DIR + sep)).toBe(true);
  });

  it('returns null for an unparseable URL', () => {
    expect(resolveAssetPath(DIR, 'not a url')).toBeNull();
  });

  it('returns null for a malformed percent-escape', () => {
    expect(resolveAssetPath(DIR, 'app://bundle/%zz')).toBeNull();
  });
});
