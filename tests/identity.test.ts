import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createIdentity} from '../src/ui/identity';

test('LAN HTTP browsers without randomUUID can create distinct room identities',()=>{
  const lanCrypto={getRandomValues:crypto.getRandomValues.bind(crypto)};
  const tokens=Array.from({length:32},()=>createIdentity(lanCrypto));
  assert.equal(new Set(tokens).size,32);
  for(const token of tokens)assert.match(token,/^[a-f0-9]{32}$/);
});
