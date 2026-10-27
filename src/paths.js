import { homedir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

// Root of this repository: the hooks and the marketplace point here.
export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..')

export const codexHome = () => process.env.CODEX_HOME || join(homedir(), '.codex')

// Settings, per-session state and metrics live next to Codex's own data.
export const dataDir = () => process.env.BCX_DATA_DIR || join(codexHome(), 'better-codex')
