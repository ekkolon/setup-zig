import assert from 'node:assert/strict';
import {createHash, generateKeyPairSync, sign} from 'node:crypto';
import {mkdtemp, rm, writeFile} from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {test} from 'node:test';
import {verifyArchive, verifySignatureMetadata} from '../src/signature.ts';

function createSignedFixture(
  content = Buffer.from('compiler test fixture'),
  filename = 'zig-x86_64-linux-0.17.0.tar.xz',
) {
  const {publicKey, privateKey} = generateKeyPairSync('ed25519');
  const keyId = Buffer.from('0102030405060708', 'hex');
  const key = Buffer.concat([
    Buffer.from('Ed'),
    keyId,
    publicKey.export({format: 'der', type: 'spki'}).subarray(-32),
  ]).toString('base64');
  const signature = sign(
    null,
    createHash('blake2b512').update(content).digest(),
    privateKey,
  );
  const comment = `timestamp:1\tfile:${filename}\thashed`;
  const commentSignature = sign(
    null,
    Buffer.concat([signature, Buffer.from(comment)]),
    privateKey,
  );
  const packet = Buffer.concat([Buffer.from('ED'), keyId, signature]);
  const text = [
    'untrusted comment: test fixture',
    packet.toString('base64'),
    `trusted comment: ${comment}`,
    commentSignature.toString('base64'),
    '',
  ].join('\n');
  return {key, text, filename, content};
}

test('verifies minisign with native Ed25519 and BLAKE2b-512', async (context) => {
  const fixture = createSignedFixture();
  const root = await mkdtemp(path.join(os.tmpdir(), 'setup-zig-signature-'));
  context.after(() => rm(root, {recursive: true, force: true}));
  const archive = path.join(root, 'archive');
  const signature = `${archive}.minisig`;
  await writeFile(archive, fixture.content);
  await writeFile(signature, fixture.text);
  const checksum = createHash('sha256').update(fixture.content).digest('hex');
  assert.equal(
    await verifyArchive(archive, signature, fixture.filename, {
      sha256: checksum,
      size: fixture.content.length,
      publicKey: fixture.key,
    }),
    checksum,
  );
  await assert.rejects(
    verifyArchive(archive, signature, fixture.filename, {
      sha256: '0'.repeat(64),
      publicKey: fixture.key,
    }),
    /SHA-256/,
  );
  await assert.rejects(
    verifyArchive(archive, signature, fixture.filename, {
      size: 1,
      publicKey: fixture.key,
    }),
    /size/,
  );
  await writeFile(archive, 'tampered compiler');
  await assert.rejects(
    verifyArchive(archive, signature, fixture.filename, {
      publicKey: fixture.key,
    }),
    /verification failed/,
  );
});

test('rejects substitution, tampered trusted comments, wrong keys, and missing signatures', () => {
  const fixture = createSignedFixture();
  assert.throws(
    () =>
      verifySignatureMetadata(
        fixture.text,
        'another-archive.tar.xz',
        fixture.key,
      ),
    /filename/,
  );
  assert.throws(
    () =>
      verifySignatureMetadata(
        fixture.text.replace('timestamp:1', 'timestamp:2'),
        fixture.filename,
        fixture.key,
      ),
    /trusted-comment/,
  );
  assert.throws(
    () =>
      verifySignatureMetadata(
        fixture.text,
        fixture.filename,
        createSignedFixture().key,
      ),
    /trusted-comment/,
  );
  assert.throws(
    () => verifySignatureMetadata(fixture.text, fixture.filename),
    /release key/,
  );
  assert.throws(
    () => verifySignatureMetadata('', fixture.filename, fixture.key),
    /Malformed/,
  );
  const lines = fixture.text.split('\n');
  const packet = Buffer.from(lines[1] ?? '', 'base64');
  packet[1] = 'd'.charCodeAt(0);
  lines[1] = packet.toString('base64');
  assert.throws(
    () =>
      verifySignatureMetadata(lines.join('\n'), fixture.filename, fixture.key),
    /prehashed/,
  );
});

test('untrusted comments do not determine the requested filename', () => {
  const fixture = createSignedFixture();
  verifySignatureMetadata(
    fixture.text.replace('test fixture', 'file:wrong.tar.xz'),
    fixture.filename,
    fixture.key,
  );
  verifySignatureMetadata(
    fixture.text.replaceAll('\n', '\r\n'),
    fixture.filename,
    fixture.key,
  );
});

test('accepts the real Zig 0.13.0 signed filename and rejects a replay for 0.17.0', () => {
  const text = [
    'untrusted comment: signature from minisign secret key',
    'RUSGOq2NVecA2aM2pTseOP756a29t33Ac9gE9f4jZuoXQVXNZ2kYoeVTuKOER5uQNPfZ+SdBa8uSCIyewXIbAaWWltW5ouG/rwQ=',
    'trusted comment: timestamp:1717729444\tfile:zig-linux-x86_64-0.13.0.tar.xz\thashed',
    '7Oots3dd6k0N8skNUp9hoi9cqp1R9Egp4k5AMkj45qLNQ4loF/7fc2L0wtfSdMd3JAE4zrAQSiOx8qj3dEI4DA==',
    '',
  ].join('\n');
  verifySignatureMetadata(text, 'zig-linux-x86_64-0.13.0.tar.xz');
  assert.throws(
    () => verifySignatureMetadata(text, 'zig-x86_64-linux-0.17.0.tar.xz'),
    /filename/,
  );
});
