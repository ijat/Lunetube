/**
 * Minimal typings for the sliver of jsdom the tests use — a real `DOMParser`,
 * so "the generated manifest is well-formed XML" is checked by an XML parser
 * instead of a regex.
 *
 * jsdom ships no types of its own, and `@types/jsdom` would pull `lib.dom` into
 * a package that runs exclusively in the Electron **main** process and must
 * never see `document` or `window`. Declaring the four members actually used
 * keeps the DOM out of this package's type surface while staying type-safe:
 * these are not `any`.
 */
declare module 'jsdom' {
  export interface XmlElement {
    readonly tagName: string;
    readonly textContent: string | null;
    getAttribute(name: string): string | null;
    getElementsByTagName(name: string): ArrayLike<XmlElement>;
  }

  export interface XmlDocument {
    readonly documentElement: XmlElement;
    getElementsByTagName(name: string): ArrayLike<XmlElement>;
  }

  export interface XmlDomParser {
    parseFromString(input: string, mimeType: 'application/xml' | 'text/xml'): XmlDocument;
  }

  export class JSDOM {
    readonly window: { readonly DOMParser: new () => XmlDomParser };
  }
}
