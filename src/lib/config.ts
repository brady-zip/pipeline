import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

const CONFIG_DIR = join(homedir(), ".config", "pipeline");
const CONFIG_PATH = join(CONFIG_DIR, "config.toml");
const LAST_CHECK_PATH = join(CONFIG_DIR, ".last_update_check");

export interface PipelineConfig {
  autoUpdate: boolean;
  pinnedVersion: string | null;
}

const DEFAULT_CONFIG = `[updates]
auto_update = true
pinned_version = ""
`;

export function ensureConfigExists(): void {
  if (!existsSync(CONFIG_DIR)) {
    mkdirSync(CONFIG_DIR, { recursive: true });
  }
  if (!existsSync(CONFIG_PATH)) {
    writeFileSync(CONFIG_PATH, DEFAULT_CONFIG);
  }
}

export function readConfig(): PipelineConfig {
  ensureConfigExists();

  const content = readFileSync(CONFIG_PATH, "utf-8");

  let autoUpdate = true;
  let pinnedVersion: string | null = null;

  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (trimmed.startsWith("#") || trimmed.startsWith("[") || !trimmed)
      continue;

    const eqIdx = trimmed.indexOf("=");
    if (eqIdx === -1) continue;

    const key = trimmed.slice(0, eqIdx).trim();
    const raw = trimmed.slice(eqIdx + 1).trim();
    const value = raw.replace(/^"(.*)"$/, "$1");

    if (key === "auto_update") {
      autoUpdate = value === "true";
    } else if (key === "pinned_version") {
      pinnedVersion = value || null;
    }
  }

  return { autoUpdate, pinnedVersion };
}

export function getLastCheckTime(): number {
  try {
    return parseInt(readFileSync(LAST_CHECK_PATH, "utf-8").trim(), 10) || 0;
  } catch {
    return 0;
  }
}

export function setLastCheckTime(): void {
  ensureConfigExists();
  writeFileSync(LAST_CHECK_PATH, String(Date.now()));
}
