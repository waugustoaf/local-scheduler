import { app } from "electron";
import { createHash } from "node:crypto";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { writeFile, mkdir, readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { shellQuote } from "../services/profiles.ts";
import { request } from "./rpc.ts";
const exec = promisify(execFile);
const label = "com.localscheduler.agent";
const xml = (s: string) =>
  s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
export async function installAgent(dir: string) {
  const path = join(homedir(), "Library/LaunchAgents", label + ".plist");
  await mkdir(join(homedir(), "Library/LaunchAgents"), { recursive: true });
  const args = app.isPackaged
    ? [process.execPath, "--agent"]
    : [process.execPath, app.getAppPath(), "--agent"];
  const buildId = createHash("sha256")
    .update(await readFile(join(__dirname, "main.cjs")))
    .digest("hex")
    .slice(0, 16);
  args.push(`--agent-build=${buildId}`);
  const plist = `<?xml version="1.0" encoding="UTF-8"?><!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd"><plist version="1.0"><dict><key>Label</key><string>${label}</string><key>ProgramArguments</key><array>${args.map((v) => `<string>${xml(v)}</string>`).join("")}</array><key>RunAtLoad</key><true/><key>KeepAlive</key><true/><key>ProcessType</key><string>Background</string><key>StandardOutPath</key><string>${xml(join(dir, "agent.log"))}</string><key>StandardErrorPath</key><string>${xml(join(dir, "agent.log"))}</string><key>EnvironmentVariables</key><dict><key>PATH</key><string>/opt/homebrew/bin:/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin</string></dict></dict></plist>`;
  const domain = `gui/${process.getuid?.()}`;
  let previous = "";
  try {
    previous = await readFile(path, "utf8");
  } catch {}
  let registered = false;
  try {
    await exec("/bin/launchctl", ["print", `${domain}/${label}`]);
    registered = true;
  } catch {}
  if (registered && previous !== plist) {
    try {
      const snapshot = await request(dir, "snapshot");
      if (
        snapshot.runs.some((r: any) =>
          ["running", "preparing"].includes(r.status),
        )
      )
        throw new Error(
          "Aguarde o fim das execuções antes de atualizar o agente.",
        );
    } catch (error) {
      if (error instanceof Error && error.message.includes("Aguarde"))
        throw error;
    }
    await exec("/bin/launchctl", ["bootout", `${domain}/${label}`]);
    registered = false;
  }
  await writeFile(path, plist, { mode: 0o600 });
  if (registered)
    await exec("/bin/launchctl", ["kickstart", `${domain}/${label}`]);
  else await exec("/bin/launchctl", ["bootstrap", domain, path]);
}
export async function installWake(dist: string) {
  const executable = "/Library/PrivilegedHelperTools/com.localscheduler.wake";
  const plistPath = "/Library/LaunchDaemons/com.localscheduler.wake.plist";
  const plist = `<?xml version="1.0"?><plist version="1.0"><dict><key>Label</key><string>com.localscheduler.wake</string><key>ProgramArguments</key><array><string>${executable}</string><string>daemon</string></array><key>MachServices</key><dict><key>com.localscheduler.wake</key><true/></dict></dict></plist>`;
  const temporary = join(app.getPath("userData"), "wake.plist");
  await writeFile(temporary, plist, { mode: 0o600 });
  const commands = [
    `/usr/bin/install -d -o root -g wheel -m 755 /Library/PrivilegedHelperTools`,
    `(/bin/launchctl bootout system ${shellQuote(plistPath)} 2>/dev/null || true)`,
    `/usr/bin/install -o root -g wheel -m 755 ${shellQuote(join(dist, "wake"))} ${shellQuote(executable)}`,
    `/usr/bin/install -o root -g wheel -m 644 ${shellQuote(temporary)} ${shellQuote(plistPath)}`,
    `/bin/launchctl bootstrap system ${shellQuote(plistPath)}`,
  ].join(" && ");
  const apple = `do shell script ${JSON.stringify(commands)} with administrator privileges`;
  await exec("/usr/bin/osascript", ["-e", apple], { timeout: 120000 });
  return true;
}
