import {createHash} from 'node:crypto';
import {mkdir, readFile, rename, writeFile} from 'node:fs/promises';
import path from 'node:path';

export function hashString(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function readJson(file: string): Promise<unknown> {
  return JSON.parse(await readFile(file, 'utf8'));
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Replaces the file atomically so readers cannot observe partial JSON. */
export async function writeJson(file: string, value: unknown): Promise<void> {
  await mkdir(path.dirname(file), {recursive: true});
  const temporary = `${file}.${process.pid}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value)}\n`, {mode: 0o600});
  await rename(temporary, file);
}

/** Tests strict containment; callers must resolve symlinks first. */
export function isPathInside(parent: string, child: string): boolean {
  const relative = path.relative(parent, child);
  return (
    relative !== '' &&
    !relative.startsWith(`..${path.sep}`) &&
    relative !== '..' &&
    !path.isAbsolute(relative)
  );
}
