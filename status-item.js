import { jsx as jsx_w77yafs4, jsxs as jsxs_eh6c78nj, Fragment as Fragment_8vg9x3sq } from "react/jsx-runtime";
import { cn } from "cn";
import { Terminal } from "lucide-react";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { Fragment, useEffect, useState } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@nyssance/shadcn/vega/components/ui/popover";
import { readBundledCliStatus } from "./native.js";
import { desktopStatusLabels } from "./status-labels.js";
export function DesktopStatusItem({
  server,
  signing,
  appVersion,
  latestVersion,
  cli,
  labels,
  openUrl,
  revealPath,
  onError
}) {
  const deviations = [server?.nonProduction ? server.label : null, signing?.label].filter(Boolean);
  if (!server && !signing && !appVersion && !cli)
    return null;
  const act = (action) => {
    Promise.resolve().then(action).catch(onError);
  };
  return jsxs_eh6c78nj(Popover, {
    children: [
      jsx_w77yafs4(PopoverTrigger, {
        className: "group text-muted-foreground flex h-full cursor-pointer items-center px-1 pe-2 text-xs",
        "aria-label": [labels.title, ...deviations].join(" · "),
        title: labels.title,
        children: deviations.length > 0 ? jsxs_eh6c78nj("span", {
          className: "flex items-center gap-1.5",
          children: [
            jsx_w77yafs4("span", {
              className: "size-2 shrink-0 rounded-full bg-amber-500",
              "aria-hidden": true
            }),
            jsx_w77yafs4("span", {
              children: deviations.join(" · ")
            })
          ]
        }) : jsx_w77yafs4(Terminal, {
          size: 16
        })
      }),
      jsx_w77yafs4(PopoverContent, {
        side: "top",
        align: "end",
        alignOffset: -8,
        className: "w-auto p-3 text-xs",
        "data-overlay": true,
        "aria-label": labels.title,
        children: jsxs_eh6c78nj("div", {
          className: "grid grid-cols-[auto_auto_1fr] items-center gap-x-2 gap-y-2",
          children: [
            server && jsxs_eh6c78nj(Fragment, {
              children: [
                jsx_w77yafs4("span", {
                  className: cn("size-2 shrink-0 rounded-full", server.nonProduction ? "bg-amber-500" : "bg-green-500"),
                  "aria-hidden": true
                }),
                jsx_w77yafs4("span", {
                  className: "text-muted-foreground justify-self-center",
                  children: labels.server
                }),
                jsx_w77yafs4("button", {
                  type: "button",
                  className: "justify-self-start hover:underline",
                  onClick: () => act(() => openUrl(server.url)),
                  title: server.url,
                  children: server.label
                })
              ]
            }),
            signing && jsxs_eh6c78nj(Fragment, {
              children: [
                jsx_w77yafs4("span", {
                  className: "size-2 shrink-0 rounded-full bg-amber-500",
                  "aria-hidden": true
                }),
                jsx_w77yafs4("span", {
                  className: "text-muted-foreground justify-self-center",
                  children: labels.signing
                }),
                jsx_w77yafs4("span", {
                  children: signing.label
                })
              ]
            }),
            appVersion && jsxs_eh6c78nj(Fragment, {
              children: [
                jsx_w77yafs4("span", {
                  className: cn("size-2 shrink-0 rounded-full", latestVersion && latestVersion !== appVersion ? "bg-amber-500" : "bg-green-500"),
                  "aria-hidden": true
                }),
                jsx_w77yafs4("span", {
                  className: "text-muted-foreground justify-self-center",
                  children: labels.version
                }),
                jsxs_eh6c78nj("span", {
                  className: "flex items-center gap-1.5 justify-self-start",
                  children: [
                    jsx_w77yafs4("code", {
                      className: "font-mono",
                      children: appVersion
                    }),
                    latestVersion && latestVersion !== appVersion && jsxs_eh6c78nj("code", {
                      className: "font-mono",
                      children: [
                        "→ ",
                        latestVersion
                      ]
                    })
                  ]
                })
              ]
            }),
            cli && jsxs_eh6c78nj("div", {
              className: "col-span-3 grid grid-cols-subgrid items-center",
              children: [
                jsx_w77yafs4("span", {
                  className: cn("size-2 shrink-0 rounded-full", cli.local?.fromSource ? "bg-amber-500" : "bg-green-500"),
                  "aria-hidden": true
                }),
                jsx_w77yafs4("span", {
                  className: "text-muted-foreground justify-self-center",
                  children: labels.cli
                }),
                cli.local ? jsx_w77yafs4("button", {
                  type: "button",
                  className: "justify-self-start font-mono hover:underline",
                  onClick: () => act(() => revealPath(cli.local.path)),
                  title: cli.local.path,
                  children: cli.local.fromSource ? labels.source : cli.version
                }) : jsx_w77yafs4("code", {
                  className: "justify-self-start font-mono",
                  children: cli.version
                })
              ]
            })
          ]
        })
      })
    ]
  });
}
export { desktopStatusLabels } from "./status-labels.js";
export function DesktopStatusBar({
  server = null,
  signing = null,
  readCli = () => readBundledCliStatus("codex"),
  openUrl = (url) => void window.open(url, "_blank"),
  revealPath = (path) => void window.open(`file://${path}`, "_blank"),
  onError = console.error,
  start,
  end
}) {
  const [appVersion, setAppVersion] = useState(null);
  const [cli, setCli] = useState(null);
  useEffect(() => {
    if (!isTauri())
      return;
    let active = true;
    getVersion().then((value) => active && setAppVersion(value)).catch(onError);
    readCli().then((value) => active && setCli(value)).catch(onError);
    return () => {
      active = false;
    };
  }, []);
  const labels = desktopStatusLabels(typeof navigator === "undefined" ? "en" : navigator.language);
  return jsxs_eh6c78nj(Fragment_8vg9x3sq, {
    children: [
      jsx_w77yafs4("div", {
        className: "pointer-events-none flex min-w-0 flex-1 items-center gap-2 [-webkit-app-region:no-drag]",
        children: jsx_w77yafs4("div", {
          className: "min-w-0 flex-1",
          children: start
        })
      }),
      jsxs_eh6c78nj("div", {
        className: "flex h-8 shrink-0 items-center gap-[4px]",
        children: [
          end,
          jsx_w77yafs4("div", {
            className: "desktop-status-item flex h-8 shrink-0 items-center [&>button]:h-6 [&>button]:rounded-[min(var(--radius-md),10px)] [&>button]:border [&>button]:border-transparent [&>button]:px-2.5 [&>button]:font-medium [&>button]:whitespace-nowrap [&>button]:outline-none [&>button]:select-none [&>button]:focus-visible:border-ring [&>button]:focus-visible:ring-3 [&>button]:focus-visible:ring-ring/50",
            children: jsx_w77yafs4(DesktopStatusItem, {
              server,
              signing,
              appVersion,
              cli,
              labels,
              openUrl,
              revealPath,
              onError
            })
          })
        ]
      })
    ]
  });
}
