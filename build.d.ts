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
  /** GitHub Releases based auto update: the app's own `owner/repo` and the Tauri updater public key. */
  updates?: { github: string; pubkey: string }
}
export declare function updaterEndpoint(github: string): string
export declare function validateConfig(value: unknown): AppConfig
export declare function safePath(root: string, relative: string): string
export declare function configureProject(root: string, options?: { icons?: boolean }): Promise<void>
