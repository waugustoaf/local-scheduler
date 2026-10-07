import { mkdir, cp, readFile, writeFile, rename, rm } from "node:fs/promises";
import { execFileSync } from "node:child_process";
import { createRequire } from "node:module";
import { join, dirname } from "node:path";
import { resolvePackage } from "./dependencies.mjs";
const require = createRequire(import.meta.url);
if (process.platform !== "darwin")
  throw new Error("O pacote deve ser criado no macOS.");
const electronRoot = dirname(require.resolve("electron/package.json"));
const source = join(electronRoot, "dist/Electron.app"),
  target = "release/Local Scheduler.app";
await mkdir("release", { recursive: true });
await rm(target, { recursive: true, force: true });
await cp(source, target, { recursive: true, dereference: true });
const resources = join(target, "Contents/Resources");
await rm(join(resources, "default_app.asar"), { force: true });
const appRoot = join(resources, "app");
await mkdir(appRoot, { recursive: true });
await cp("dist", join(appRoot, "dist"), { recursive: true });
const pkg = JSON.parse(await readFile("package.json", "utf8"));
await writeFile(
  join(appRoot, "package.json"),
  JSON.stringify(
    { name: pkg.name, version: pkg.version, main: pkg.main },
    null,
    2,
  ),
);
const copied = new Set();
async function dependency(name, from) {
  const { root, meta } = await resolvePackage(name, from);
  const key = meta.name;
  if (copied.has(key)) return;
  copied.add(key);
  const dest = join(appRoot, "node_modules", meta.name);
  await mkdir(dirname(dest), { recursive: true });
  await cp(root, dest, { recursive: true, dereference: true });
  for (const dep of Object.keys(meta.dependencies ?? {}))
    await dependency(dep, root);
}
for (const name of ["pg", "ssh2"]) await dependency(name, process.cwd());
const plist = join(target, "Contents/Info.plist");
const values = {
  CFBundleName: "Local Scheduler",
  CFBundleDisplayName: "Local Scheduler",
  CFBundleIdentifier: "com.localscheduler.app",
  CFBundleExecutable: "Local Scheduler",
  CFBundleShortVersionString: pkg.version,
  CFBundleVersion: pkg.version,
};
for (const [key, value] of Object.entries(values))
  execFileSync("/usr/libexec/PlistBuddy", [
    "-c",
    `Set :${key} ${value}`,
    plist,
  ]);
await rename(
  join(target, "Contents/MacOS/Electron"),
  join(target, "Contents/MacOS/Local Scheduler"),
);
execFileSync(
  "/usr/bin/codesign",
  ["--force", "--deep", "--sign", "-", target],
  { stdio: "inherit" },
);
console.log(`Pacote criado: ${target}`);
