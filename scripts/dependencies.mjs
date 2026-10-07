import { createRequire } from "node:module";
import { dirname, join } from "node:path";
import { readFile } from "node:fs/promises";
export async function resolvePackage(name, from) {
  const require = createRequire(join(from, "package.json"));
  let root;
  try {
    root = dirname(require.resolve(`${name}/package.json`));
  } catch {
    root = dirname(require.resolve(name));
  }
  while (true) {
    try {
      const meta = JSON.parse(
        await readFile(join(root, "package.json"), "utf8"),
      );
      if (meta.name === name) return { root, meta };
    } catch {}
    const parent = dirname(root);
    if (parent === root) throw new Error(`Pacote não localizado: ${name}`);
    root = parent;
  }
}
