import { mkdir, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { build } from 'esbuild';

await rm('dist', { recursive: true, force: true });
await mkdir('dist');
const result = await build({
  entryPoints: ['src/main.ts', 'src/post.ts'],
  outdir: 'dist',
  bundle: true,
  splitting: true,
  platform: 'node',
  target: 'node24',
  format: 'esm',
  metafile: true,
  legalComments: 'eof',
  banner: {
    js: "import { createRequire as __createRequire } from 'node:module'; const require = __createRequire(import.meta.url);",
  },
});

const packages = new Set();
for (const input of Object.keys(result.metafile.inputs)) {
  if (!input.includes('node_modules/')) continue;
  const marker = input.lastIndexOf('node_modules/');
  const parts = input.slice(marker + 'node_modules/'.length).split('/');
  const count = parts[0].startsWith('@') ? 2 : 1;
  const directory = input.slice(0, marker) + 'node_modules/' + parts.slice(0, count).join('/');
  packages.add(directory);
}
const notices = [];
for (const directory of [...packages].sort()) {
  const pkg = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
  const files = (await readdir(directory))
    .filter((file) => /^(licen[cs]e|copying|notice)([._-]|$)/i.test(file))
    .sort();
  if (!files.length && pkg.name === '@nodable/entities' && pkg.version === '3.1.0') {
    notices.push(
      `${pkg.name}@${pkg.version}\n${await readFile('licenses/nodable-entities.txt', 'utf8')}`,
    );
    continue;
  }
  if (!files.length) throw new Error(`Missing license file: ${pkg.name}`);
  const texts = await Promise.all(
    files.map((file) => readFile(path.join(directory, file), 'utf8')),
  );
  notices.push(`${pkg.name}@${pkg.version}\n${texts.join('\n')}`);
}
await writeFile('dist/licenses.txt', `${notices.join('\n\n--------------------\n\n')}\n`);
await writeFile('dist/package.json', '{"type":"module"}\n');
