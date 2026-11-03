/** How the application treats a staged file when it signs its bundle. */
export type SigningClass = "resign" | "resource"

export interface StagedFile {
  path: string
  /** `resign`: our library or helper, signed with the application identity. `resource`: plain file. */
  signing: SigningClass
}

/**
 * Build-time only. Stage one module's library for `target` from the installed `@alwith/module-<module>`
 * package (resolved from `from`, usually `import.meta.url` of the staging script): validates identity,
 * contract generation (when `contract` is given, it must match), ABI, checksum and the device helper, then
 * copies the library (and helper, executable) into `destination` and the licences into
 * `<licenses>/alwith-native-<module>/`. Returns every staged file with its signing class.
 */
export declare function stageNativeModule(
  from: string,
  module: string,
  target: string,
  destination: string,
  licenses: string,
  contract?: number
): StagedFile[]
