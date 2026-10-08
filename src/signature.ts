import {createHash, createPublicKey, type KeyObject, verify} from 'node:crypto';
import {createReadStream} from 'node:fs';
import {readFile} from 'node:fs/promises';

// From https://ziglang.org/download/. Rotation requires an action release.
export const ZIG_PUBLIC_KEY =
  'RWSGOq2NVecA2UPNdBUZykf1CCb147pkmdtYxgb3Ti+JO/wCYvhbAb/U';
// ASN.1 SubjectPublicKeyInfo prefix for a raw 32-byte Ed25519 public key.
const ED25519_SPKI = Buffer.from('302a300506032b6570032100', 'hex');

interface ArchiveSignature {
  signature: Buffer;
  key: KeyObject;
}

interface ArchiveChecks {
  sha256?: string;
  size?: number;
  publicKey?: string;
}

function decodeBase64(text: string, size: number): Buffer {
  const buffer = Buffer.from(text, 'base64');
  if (buffer.length !== size || buffer.toString('base64') !== text) {
    throw new Error('Malformed minisign data.');
  }
  return buffer;
}

/** Verifies the trusted comment and filename, without reading archive bytes. */
export function verifySignatureMetadata(
  text: string,
  filename: string,
  publicKey = ZIG_PUBLIC_KEY,
): ArchiveSignature {
  const lines = text.trimEnd().split(/\r?\n/);
  if (
    lines.length !== 4 ||
    !lines[0]?.startsWith('untrusted comment: ') ||
    !lines[2]?.startsWith('trusted comment: ')
  ) {
    throw new Error('Malformed minisign signature.');
  }
  // Packets contain a 2-byte algorithm, 8-byte key ID, then key or signature.
  const key = decodeBase64(publicKey, 42);
  const packet = decodeBase64(lines[1] ?? '', 74);
  if (
    key.subarray(0, 2).toString() !== 'Ed' ||
    packet.subarray(0, 2).toString() !== 'ED'
  ) {
    throw new Error('Expected a prehashed Ed25519 minisign signature.');
  }
  if (!key.subarray(2, 10).equals(packet.subarray(2, 10))) {
    throw new Error('The archive was not signed with the Zig release key.');
  }
  const publicKeyObject = createPublicKey({
    key: Buffer.concat([ED25519_SPKI, key.subarray(10)]),
    format: 'der',
    type: 'spki',
  });
  const signature = packet.subarray(10);
  const comment = lines[2].slice('trusted comment: '.length);
  if (
    !verify(
      null,
      Buffer.concat([signature, Buffer.from(comment)]),
      publicKeyObject,
      decodeBase64(lines[3] ?? '', 64),
    )
  ) {
    throw new Error('Invalid minisign trusted-comment signature.');
  }
  const names = [...comment.matchAll(/(?:^|\s)file:([^\s]+)/g)].map(
    (match) => match[1],
  );
  if (names.length !== 1 || names[0] !== filename) {
    throw new Error(
      'Signed archive filename does not match the requested Zig version and platform.',
    );
  }
  return {signature, key: publicKeyObject};
}

/** Verifies the archive and its signed metadata, then returns SHA-256. */
export async function verifyArchive(
  archive: string,
  signatureFile: string,
  filename: string,
  checks: ArchiveChecks = {},
): Promise<string> {
  const {signature, key} = verifySignatureMetadata(
    await readFile(signatureFile, 'utf8'),
    filename,
    checks.publicKey,
  );
  const prehash = createHash('blake2b512');
  const sha256 = createHash('sha256');
  let size = 0;
  for await (const chunk of createReadStream(archive)) {
    size += chunk.length;
    if (size > 512 * 1024 * 1024) {
      throw new Error('Zig archive exceeds 512 MiB.');
    }
    prehash.update(chunk);
    sha256.update(chunk);
  }
  if (checks.size !== undefined && size !== checks.size) {
    throw new Error('Zig archive size does not match the download index.');
  }
  const checksum = sha256.digest('hex');
  if (checks.sha256 && checksum !== checks.sha256) {
    throw new Error('Zig archive SHA-256 mismatch.');
  }
  if (!verify(null, prehash.digest(), key, signature)) {
    throw new Error('Zig archive minisign verification failed.');
  }
  return checksum;
}
