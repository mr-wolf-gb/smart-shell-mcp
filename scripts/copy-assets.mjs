import { cp, mkdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const root = resolve(__dirname, '..');
const src = resolve(root, 'src');
const dist = resolve(root, 'dist');

await mkdir(dist, { recursive: true });

const files = [
  'command-map.json',
  'project-commands.json'
];

for (const f of files) {
  await cp(resolve(src, f), resolve(dist, f), { force: true });
}
