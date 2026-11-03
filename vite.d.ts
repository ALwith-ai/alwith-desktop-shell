/** Applies the remembered theme before the first paint. */
export declare function themeHtml(html: string): string
/** Inserts the boot wordmark into an empty `#root` of the app's `index.html`. */
export declare function bootLoaderHtml(html: string): string
/** Vite plugin for every page of an app on the shell: the remembered theme before the first paint, and the boot wordmark in the main entry. */
export declare function desktopShellPages(): {
  name: string
  transformIndexHtml: { order: "pre"; handler: (html: string, context: { filename: string }) => string }
}
