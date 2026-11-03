// Cold-start wordmark for the main window: the brand is stroked in, then filled, over the window
// vibrancy until React replaces #root. Ported from ALwith Desktop's __boot-loader.
const STYLE = `
html,
body {
  margin: 0;
  padding: 0;
}
.__boot-loader {
  /* Visible even while the host hides the page until its theme is applied: the wordmark is theme-free. */
  visibility: visible;
  display: flex;
  width: 100vw;
  height: 100vh;
  align-items: center;
  justify-content: center;
  background: transparent;
  -webkit-user-select: none;
  user-select: none;
  cursor: default;
}
.__boot-logo {
  width: 50vw;
  max-width: 540px;
  height: auto;
}
.__boot-logo text {
  font-family:
    system-ui,
    -apple-system,
    "Segoe UI",
    sans-serif;
  font-size: 160px;
  font-weight: 700;
  fill: transparent;
  stroke: #a227ff;
  stroke-width: 1.5;
  stroke-dasharray: 2600;
  stroke-dashoffset: 2600;
  animation: __boot-draw 3s linear forwards;
}
@keyframes __boot-draw {
  0% {
    stroke-dashoffset: 2600;
    fill: transparent;
  }
  70% {
    stroke-dashoffset: 0;
    fill: transparent;
  }
  80% {
    stroke-dashoffset: 0;
    fill: transparent;
  }
  100% {
    stroke-dashoffset: 0;
    fill: #a227ff;
  }
}
`
// Only the main window plays it; other windows that load the same entry hide it. A plain browser
// (no Tauri metadata) counts as the main window.
const GUARD = `try{if(window.__TAURI_INTERNALS__.metadata.currentWindow.label!=="main"){var s=document.createElement("style");s.textContent=".__boot-loader{display:none!important}";document.head.appendChild(s)}}catch(e){}`
const MARKUP = `<div class="__boot-loader" data-tauri-drag-region><svg class="__boot-logo" viewBox="0 0 640 200" xmlns="http://www.w3.org/2000/svg"><text x="50%" y="50%" dominant-baseline="central" text-anchor="middle">\u039bLwith</text></svg></div>`
// Before the first paint every page takes the theme the shell remembered (theme.js writes it), so no
// window flashes the wrong scheme while the app loads its settings.
const THEME = `try{var t=localStorage.getItem("alwith-desktop-shell.theme");if(t!=="light"&&t!=="dark")t=matchMedia("(prefers-color-scheme: dark)").matches?"dark":"light";var r=document.documentElement;r.classList.remove("light","dark");r.classList.add(t);r.style.colorScheme=t}catch(e){}`
const ROOT = '<div id="root"></div>'

/** Applies the remembered theme before the first paint. */
export function themeHtml(html) {
  return html.replace("<head>", `<head><script>${THEME}</script>`)
}

/** Inserts the boot wordmark into an empty `#root` of the app's `index.html`. */
export function bootLoaderHtml(html) {
  if (!html.includes(ROOT)) return html
  return html.replace("</head>", `<style>${STYLE}</style><script>${GUARD}</script></head>`).replace(ROOT, `<div id="root">${MARKUP}</div>`)
}

/** Vite plugin for every page of an app on the shell: the remembered theme before the first paint, and the boot wordmark in the main entry. */
export function desktopShellPages() {
  return {
    name: "alwith-desktop-shell:pages",
    transformIndexHtml: {
      order: "pre",
      handler: (html, context) => {
        const themed = themeHtml(html)
        return /(^|[\\/])index\.html$/.test(context.filename) ? bootLoaderHtml(themed) : themed
      }
    }
  }
}
