/**
 * `crypto.randomUUID()` is a global in both modern Node and modern browsers
 * (Web Crypto API), unlike `node:crypto`'s named export -- using the global
 * keeps this package bundler-friendly for the web client instead of pulling
 * in a Node-only module that bundlers can't polyfill.
 */
export function randomUUID(): string {
  return globalThis.crypto.randomUUID();
}
