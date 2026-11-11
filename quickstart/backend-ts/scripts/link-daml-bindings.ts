import { mkdir, readdir, rm, symlink } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';

/** Locates the codegen output independently of the working directory. */
const generated = resolve(import.meta.dir, '../build/generated-daml-bindings');

// Generated packages import their siblings by npm name. Local links let them use
// the workspace's locked runtime dependencies without a second package install.
for (const entry of await readdir(generated, { withFileTypes: true })) {
  if (!entry.isDirectory() || entry.name === 'node_modules') continue;
  /** Resolves the generated package directory that the symlink will point to. */
  const directory = join(generated, entry.name);
  /** Reads the npm name used by sibling packages when importing this binding. */
  const { name } = (await Bun.file(join(directory, 'package.json')).json()) as { name: string };
  /** Places the symlink where module resolution looks up that npm name. */
  const link = join(generated, 'node_modules', name);
  await mkdir(dirname(link), { recursive: true });
  await rm(link, { force: true });
  await symlink(relative(dirname(link), directory), link, 'dir');
}
