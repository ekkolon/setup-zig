import assert from 'node:assert/strict';
import { createHash, generateKeyPairSync, sign } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { parseSignature, verifyArchive } from '../src/signature.ts';

function fixture(
  content = Buffer.from('compiler test fixture'),
  filename = 'zig-x86_64-linux-0.17.0.tar.xz',
) {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const keyId = Buffer.from('0102030405060708', 'hex');
  const key = Buffer.concat([
    Buffer.from('Ed'),
    keyId,
    publicKey.export({ format: 'der', type: 'spki' }).subarray(-32),
  ]).toString('base64');
  const signature = sign(null, createHash('blake2b512').update(content).digest(), privateKey);
  const comment = `timestamp:1\tfile:${filename}\thashed`;
  const global = sign(null, Buffer.concat([signature, Buffer.from(comment)]), privateKey);
  const text = `untrusted comment: test fixture\n${Buffer.concat([Buffer.from('ED'), keyId, signature]).toString('base64')}\ntrusted comment: ${comment}\n${global.toString('base64')}\n`;
  return { key, text, filename, content };
}

test('verifies minisign with native Ed25519 and BLAKE2b-512', async (t) => {
  const f = fixture();
  const root = await mkdtemp(path.join(os.tmpdir(), 'setup-zig-signature-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const archive = path.join(root, 'archive');
  const signature = `${archive}.minisig`;
  await writeFile(archive, f.content);
  await writeFile(signature, f.text);
  const checksum = createHash('sha256').update(f.content).digest('hex');
  assert.equal(
    await verifyArchive(archive, signature, f.filename, checksum, f.content.length, f.key),
    checksum,
  );
  await assert.rejects(
    verifyArchive(archive, signature, f.filename, '0'.repeat(64), undefined, f.key),
    /SHA-256/,
  );
  await assert.rejects(verifyArchive(archive, signature, f.filename, undefined, 1, f.key), /size/);
  await writeFile(archive, 'tampered compiler');
  await assert.rejects(
    verifyArchive(archive, signature, f.filename, undefined, undefined, f.key),
    /verification failed/,
  );
});
test('rejects substitution, tampered trusted comments, wrong keys, and missing signatures', () => {
  const f = fixture();
  assert.throws(() => parseSignature(f.text, 'another-archive.tar.xz', f.key), /filename/);
  assert.throws(
    () => parseSignature(f.text.replace('timestamp:1', 'timestamp:2'), f.filename, f.key),
    /trusted-comment/,
  );
  assert.throws(() => parseSignature(f.text, f.filename, fixture().key), /trusted-comment/);
  assert.throws(() => parseSignature(f.text, f.filename), /release key/);
  assert.throws(() => parseSignature('', f.filename, f.key), /Malformed/);
  const lines = f.text.split('\n');
  const packet = Buffer.from(lines[1] ?? '', 'base64');
  packet[1] = 'd'.charCodeAt(0);
  lines[1] = packet.toString('base64');
  assert.throws(() => parseSignature(lines.join('\n'), f.filename, f.key), /prehashed/);
});
test('untrusted comments do not determine the requested filename', () => {
  const f = fixture();
  parseSignature(f.text.replace('test fixture', 'file:wrong.tar.xz'), f.filename, f.key);
  parseSignature(f.text.replaceAll('\n', '\r\n'), f.filename, f.key);
});
test('accepts the real Zig 0.13.0 signed filename and rejects a replay for 0.17.0', () => {
  const text =
    'untrusted comment: signature from minisign secret key\nRUSGOq2NVecA2aM2pTseOP756a29t33Ac9gE9f4jZuoXQVXNZ2kYoeVTuKOER5uQNPfZ+SdBa8uSCIyewXIbAaWWltW5ouG/rwQ=\ntrusted comment: timestamp:1717729444\tfile:zig-linux-x86_64-0.13.0.tar.xz\thashed\n7Oots3dd6k0N8skNUp9hoi9cqp1R9Egp4k5AMkj45qLNQ4loF/7fc2L0wtfSdMd3JAE4zrAQSiOx8qj3dEI4DA==\n';
  parseSignature(text, 'zig-linux-x86_64-0.13.0.tar.xz');
  assert.throws(() => parseSignature(text, 'zig-x86_64-linux-0.17.0.tar.xz'), /filename/);
});
