import { powerSaveBlocker } from "electron";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import type { WakePort } from "../core/types.ts";
const exec = promisify(execFile);
export class MacPower implements WakePort {
  private blocker: number | null = null;
  private dist: string;
  private last: string | undefined;
  constructor(dist: string) {
    this.dist = dist;
  }
  hold(active: boolean) {
    if (active && this.blocker === null)
      this.blocker = powerSaveBlocker.start("prevent-app-suspension");
    if (!active && this.blocker !== null) {
      powerSaveBlocker.stop(this.blocker);
      this.blocker = null;
    }
  }
  async status() {
    try {
      await exec(join(this.dist, "wake"), "status".split(" "), {
        timeout: 16000,
      });
      return true;
    } catch {
      return false;
    }
  }
  async sync(nextAt: string | null) {
    const wake = nextAt ? Date.parse(nextAt) - 5 * 60000 : 0;
    const stamp = wake > Date.now() ? String(wake / 1000) : "";
    if (this.last === stamp) return;
    const result = await exec(join(this.dist, "wake"), ["sync", stamp], {
      timeout: 16000,
    });
    if (result.stdout.trim() !== "ok") throw new Error(result.stdout.trim());
    this.last = stamp;
  }
}
