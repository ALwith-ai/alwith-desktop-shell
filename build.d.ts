export interface AppConfig {
  name: string
  productName: string
  identifier: string
  version: string
  icon: string
  languages: string[]
  window: { width: number; height: number; minWidth: number; minHeight: number }
  preset: "chat"
  modules: string[]
  template: { name: "create-alwith"; version: string }
  /**
   * Signed auto update. `pubkey` is the Tauri updater public key; releases come from `endpoints`
   * (HTTPS on any host, with `{{target}}`, `{{arch}}`, `{{current_version}}`, `{{bundle_type}}`),
   * the GitHub Releases of `github` (`owner/repo`), or both. `requireSignedVersion` defaults to true.
   */
  updates?: { github?: string; endpoints?: string[]; pubkey: string; requireSignedVersion?: boolean }
}
export declare function updaterEndpoint(github: string): string
export declare function updaterConfig(updates: NonNullable<AppConfig["updates"]>): {
  pubkey: string
  endpoints: string[]
  requireSignedVersion: boolean
  windows: { installMode: "passive" }
}
export declare function validateConfig(value: unknown): AppConfig
export declare function safePath(root: string, relative: string): string
export declare function configureProject(root: string, options?: { icons?: boolean }): Promise<void>
/** Generates the Tauri bundle icons from `alwith.app.json` when they are missing (a fresh project); existing icons stay. */
export declare function ensureIcons(root: string): Promise<void>
