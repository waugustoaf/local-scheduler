import { build } from "esbuild";
import { mkdir, copyFile } from "node:fs/promises";
import { execFileSync } from "node:child_process";
await mkdir("dist", { recursive: true });
await build({
  entryPoints: {
    main: "src/desktop/main.ts",
    preload: "src/desktop/preload.ts",
    worker: "src/desktop/worker.ts",
  },
  outdir: "dist",
  outExtension: { ".js": ".cjs" },
  bundle: true,
  platform: "node",
  target: "node22",
  format: "cjs",
  external: ["electron", "pg", "ssh2"],
  sourcemap: true,
});
await build({
  entryPoints: ["src/ui/index.tsx"],
  outfile: "dist/ui.js",
  bundle: true,
  platform: "browser",
  target: "chrome132",
  format: "iife",
  minify: true,
  define: { "process.env.NODE_ENV": '"production"' },
  sourcemap: true,
});
await copyFile("src/ui/index.html", "dist/index.html");
if (process.platform === "darwin") {
  await mkdir(".swiftcache", { recursive: true });
  execFileSync(
    "/usr/bin/xcrun",
    [
      "swiftc",
      "native/Wake.swift",
      "-o",
      "dist/wake",
      "-module-cache-path",
      ".swiftcache",
      "-framework",
      "Foundation",
      "-framework",
      "IOKit",
    ],
    { stdio: "inherit" },
  );
}
console.log("Build concluído em dist.");
