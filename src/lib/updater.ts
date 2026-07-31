import { $ } from "bun";
import { renameSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, basename } from "node:path";
import { readConfig, getLastCheckTime, setLastCheckTime } from "./config.js";
import pkg from "../../package.json" with { type: "json" };

const REPO = "brady-zip/pipeline";
const ASSET_NAME = "pipeline-darwin-arm64";
const ONE_HOUR_MS = 60 * 60 * 1000;

export async function checkForUpdates(): Promise<void> {
  try {
    // Only self-update the installed standalone binary. When running from source
    // (e.g. `bun run src/index.ts`), process.execPath is the interpreter, and
    // replacing it would clobber the user's bun/node install.
    const exe = basename(process.execPath);
    if (exe === "bun" || exe === "node") return;

    const config = readConfig();
    if (!config.autoUpdate) return;

    const lastCheck = getLastCheckTime();
    if (Date.now() - lastCheck < ONE_HOUR_MS) return;

    setLastCheckTime();

    const targetVersion = config.pinnedVersion || (await getLatestVersion());
    if (!targetVersion) return;

    const currentVersion = pkg.version;
    if (normalizeVersion(targetVersion) === normalizeVersion(currentVersion))
      return;

    const tmpPath = join(tmpdir(), `pipeline-update-${Date.now()}`);
    const tag = targetVersion.startsWith("v")
      ? targetVersion
      : `v${targetVersion}`;

    await $`gh release download ${tag} --repo ${REPO} --pattern ${ASSET_NAME} --output ${tmpPath}`.quiet();
    await $`chmod +x ${tmpPath}`.quiet();

    renameSync(tmpPath, process.execPath);

    console.log(
      `pipeline updated: v${currentVersion} → ${tag} (takes effect next run)`,
    );
  } catch {
    // best-effort — silent failure
  }
}

async function getLatestVersion(): Promise<string | null> {
  try {
    const tag =
      await $`gh api repos/${REPO}/releases/latest --jq '.tag_name'`.text();
    return tag.trim() || null;
  } catch {
    return null;
  }
}

function normalizeVersion(v: string): string {
  return v.replace(/^v/, "");
}
