import { describe, expect, it } from 'vitest';
import {
  decodeTargetParam,
  encodeTargetParam,
  isAllowedUrl,
  isRouteName,
  MAX_TARGET_PARAM_LENGTH,
  PRODUCTION_ROUTES,
  resolveRedirect,
  resolveTarget,
} from '../allowlist.js';

const media = PRODUCTION_ROUTES.media;
const img = PRODUCTION_ROUTES.img;
const caption = PRODUCTION_ROUTES.caption;

const enc = encodeTargetParam;

describe('allowlist — rejections (the SSRF surface)', () => {
  // The `googlevideo.com.evil.com` family: every one of these contains the
  // string `.googlevideo.com` somewhere, so an `endsWith`/`includes` test on
  // the raw URL — or on the wrong URL component — would admit it.
  const suffixConfusion = [
    'https://googlevideo.com.evil.com/videoplayback',
    'https://evil.com/?x=.googlevideo.com',
    'https://evil.com/#.googlevideo.com',
    'https://evil.com/a.googlevideo.com',
    'https://evil.com/#https://rr1---sn-x.googlevideo.com/',
    'https://xgooglevideo.com/',
    'https://rr1---sn-x.googlevideo.com.evil.com/',
    // Trailing FQDN dot — `URL` keeps it, resolvers often treat it as equal.
    'https://rr1---sn-x.googlevideo.com./videoplayback',
    // Userinfo confusion: the "host" a careless reader sees is not the host.
    'https://rr1---sn-x.googlevideo.com@evil.com/',
    'https://rr1---sn-x.googlevideo.com:pw@evil.com/',
  ];

  it.each(suffixConfusion)('rejects host-suffix confusion: %s', (target) => {
    expect(resolveTarget(enc(target), media)).toBeNull();
  });

  const badSchemes = [
    'file:///etc/passwd',
    'file://127.0.0.1/etc/passwd',
    'http://rr1---sn-x.googlevideo.com/videoplayback',
    'ftp://rr1---sn-x.googlevideo.com/',
    'data:text/html,<script>alert(1)</script>',
    'javascript:alert(1)',
    'blob:https://rr1---sn-x.googlevideo.com/abc',
    'ws://rr1---sn-x.googlevideo.com/',
    'app://bundle/index.html',
  ];

  it.each(badSchemes)('rejects non-https scheme: %s', (target) => {
    expect(resolveTarget(enc(target), media)).toBeNull();
  });

  const literals = [
    'https://127.0.0.1/videoplayback',
    'https://127.0.0.1:9000/videoplayback',
    'https://0.0.0.0/',
    'https://169.254.169.254/latest/meta-data/', // cloud metadata
    'https://10.0.0.5/',
    'https://[::1]/videoplayback',
    'https://[::ffff:127.0.0.1]/',
    'https://[fe80::1]/',
    'https://2130706433/', // decimal-encoded 127.0.0.1
    'https://0x7f000001/', // hex-encoded 127.0.0.1
    'https://localhost/videoplayback',
  ];

  it.each(literals)('rejects IP literal / loopback host: %s', (target) => {
    expect(resolveTarget(enc(target), media)).toBeNull();
    expect(resolveTarget(enc(target), img)).toBeNull();
    expect(resolveTarget(enc(target), caption)).toBeNull();
  });

  const unparseable = [
    '//evil.com',
    '//rr1---sn-x.googlevideo.com/videoplayback',
    '/videoplayback',
    'rr1---sn-x.googlevideo.com/videoplayback',
    '',
    '   ',
    'https://',
  ];

  it.each(unparseable)('rejects a target that is not an absolute URL: %j', (target) => {
    expect(resolveTarget(enc(target), media)).toBeNull();
  });

  it('rejects a cross-route target (an image host on the media route and back)', () => {
    expect(resolveTarget(enc('https://i.ytimg.com/vi/abc/hq720.jpg'), media)).toBeNull();
    expect(resolveTarget(enc('https://rr1---sn-x.googlevideo.com/videoplayback'), img)).toBeNull();
    expect(resolveTarget(enc('https://www.youtube.com/api/timedtext?v=abc'), media)).toBeNull();
  });

  it('rejects a youtube.com path that is not /api/timedtext', () => {
    expect(resolveTarget(enc('https://www.youtube.com/watch?v=abc'), caption)).toBeNull();
    expect(
      resolveTarget(enc('https://www.youtube.com/api/timedtext/../watch'), caption),
    ).toBeNull();
    // `URL` normalises `..` segments, so this one resolves to /api/timedtext and
    // is legitimately allowed — asserted below in the accept block. The guard
    // that matters is that a *different* endpoint cannot be reached.
    expect(resolveTarget(enc('https://www.youtube.com/api/timedtextx'), caption)).toBeNull();
    expect(resolveTarget(enc('https://youtube.com/api/timedtext'), caption)).toBeNull();
    expect(resolveTarget(enc('https://m.youtube.com/api/timedtext'), caption)).toBeNull();
  });

  it('rejects a missing, oversized or non-canonical u parameter', () => {
    expect(resolveTarget(null, media)).toBeNull();
    expect(resolveTarget(undefined, media)).toBeNull();
    expect(resolveTarget('', media)).toBeNull();
    // Not base64url at all.
    expect(decodeTargetParam('!!!!')).toBeNull();
    expect(decodeTargetParam('aGVsbG8=')).toBeNull(); // padded
    expect(decodeTargetParam('aGVsbG8/')).toBeNull(); // standard-base64 alphabet
    expect(decodeTargetParam('aGVsbG8+')).toBeNull();
    // Canonical-encoding guard: `Buffer` ignores the non-zero trailing bits in
    // `aGVsbG9=`-style input, so the round-trip check is what rejects it.
    expect(decodeTargetParam('aGVsbG9')).toBeNull();
    expect(decodeTargetParam('a'.repeat(MAX_TARGET_PARAM_LENGTH + 1))).toBeNull();
  });

  it('rejects a target that decodes to invalid UTF-8', () => {
    const invalid = Buffer.from([0xff, 0xfe, 0xfd]).toString('base64url');
    expect(decodeTargetParam(invalid)).toBeNull();
  });

  it('rejects an underscore host, which `\\w` would have admitted', () => {
    expect(resolveTarget(enc('https://rr1_sn-x.googlevideo.com/videoplayback'), media)).toBeNull();
  });

  it('rejects an IDN homograph that punycodes away from the apex', () => {
    // U+03BF GREEK SMALL LETTER OMICRON in place of both `o`s.
    expect(resolveTarget(enc('https://rr1.gοοglevideo.com/'), media)).toBeNull();
  });
});

describe('allowlist — accepts exactly the intended hosts', () => {
  const mediaOk = [
    'https://rr3---sn-4g5edn7z.googlevideo.com/videoplayback?expire=1&ei=2',
    'https://redirector.googlevideo.com/videoplayback',
    'https://r5---sn-x.googlevideo.com/videoplayback',
  ];
  it.each(mediaOk)('allows media host %s', (target) => {
    expect(resolveTarget(enc(target), media)?.href).toBe(new URL(target).href);
  });

  const imgOk = [
    'https://i.ytimg.com/vi/dQw4w9WgXcQ/maxresdefault.jpg',
    'https://i9.ytimg.com/sb/abc/storyboard3_L2/M0.jpg',
    'https://yt3.ggpht.com/ytc/AAA=s176-c-k-c0x00ffffff-no-rj',
    'https://yt3.googleusercontent.com/AAA=s176',
    'https://lh3.googleusercontent.com/AAA=s88',
  ];
  it.each(imgOk)('allows image host %s', (target) => {
    expect(resolveTarget(enc(target), img)?.href).toBe(new URL(target).href);
  });

  it('allows the timedtext endpoint, including after path normalisation', () => {
    const plain = 'https://www.youtube.com/api/timedtext?v=abc&lang=en&fmt=vtt';
    expect(resolveTarget(enc(plain), caption)?.href).toBe(plain);
    expect(resolveTarget(enc('https://www.youtube.com/x/../api/timedtext'), caption)?.href).toBe(
      'https://www.youtube.com/api/timedtext',
    );
  });

  it('upper-cases in the host are normalised by URL and still match', () => {
    expect(resolveTarget(enc('https://RR1---SN-X.GOOGLEVIDEO.COM/vp'), media)?.hostname).toBe(
      'rr1---sn-x.googlevideo.com',
    );
  });

  it('round-trips a long, query-heavy googlevideo URL', () => {
    const target = `https://rr3---sn-4g5edn7z.googlevideo.com/videoplayback?${'k=v&'.repeat(300)}end=1`;
    const encoded = enc(target);
    expect(encoded.length).toBeLessThanOrEqual(MAX_TARGET_PARAM_LENGTH);
    expect(resolveTarget(encoded, media)?.href).toBe(target);
  });
});

describe('resolveRedirect', () => {
  const from = new URL('https://rr1---sn-x.googlevideo.com/videoplayback');

  it('follows a relative Location within the same allowed host', () => {
    expect(resolveRedirect('/videoplayback?redirected=1', from, media)?.href).toBe(
      'https://rr1---sn-x.googlevideo.com/videoplayback?redirected=1',
    );
  });

  it('follows an absolute Location to another allowed host', () => {
    expect(resolveRedirect('https://rr9---sn-y.googlevideo.com/vp', from, media)?.hostname).toBe(
      'rr9---sn-y.googlevideo.com',
    );
  });

  it.each([
    'https://evil.com/',
    'http://rr1---sn-x.googlevideo.com/vp', // scheme downgrade
    'https://googlevideo.com.evil.com/',
    'https://127.0.0.1:9/',
    'file:///etc/passwd',
    '//evil.com/vp', // scheme-relative: resolves to https://evil.com/vp
    'https://i.ytimg.com/vi/a/b.jpg', // allowed on a *different* route only
  ])('refuses to follow Location: %s', (location) => {
    expect(resolveRedirect(location, from, media)).toBeNull();
  });

  it('refuses an unparseable Location', () => {
    expect(resolveRedirect('http://[', from, media)).toBeNull();
  });
});

describe('isAllowedUrl / isRouteName', () => {
  it('never mutates regex state across calls (no `g` flag)', () => {
    const url = new URL('https://rr1---sn-x.googlevideo.com/vp');
    for (let i = 0; i < 5; i += 1) expect(isAllowedUrl(url, media)).toBe(true);
  });

  it('recognises exactly the three route names', () => {
    expect(['media', 'img', 'caption'].every(isRouteName)).toBe(true);
    expect(isRouteName('..')).toBe(false);
    expect(isRouteName('')).toBe(false);
    expect(isRouteName('Media')).toBe(false);
  });
});
