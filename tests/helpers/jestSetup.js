import '@testing-library/jest-dom';
import { TextDecoder, TextEncoder } from 'node:util';

globalThis.TextDecoder = TextDecoder;
globalThis.TextEncoder = TextEncoder;

if (typeof Element !== 'undefined' && !Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
