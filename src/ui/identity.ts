/** UUIDs require HTTPS in browsers; getRandomValues also works on LAN HTTP. */
export function createIdentity(source: Pick<Crypto,'getRandomValues'> & Partial<Pick<Crypto,'randomUUID'>> = globalThis.crypto): string {
  if(source.randomUUID)return source.randomUUID();
  return Array.from(source.getRandomValues(new Uint8Array(16)),byte=>byte.toString(16).padStart(2,'0')).join('');
}
