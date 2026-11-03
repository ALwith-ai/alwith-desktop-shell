import { jsx as jsx_w77yafs4, jsxs as jsxs_eh6c78nj } from "react/jsx-runtime";
import { getVersion } from "@tauri-apps/api/app";
import { isTauri } from "@tauri-apps/api/core";
import { cn } from "cn";
import { MinusIcon, SquareIcon, XIcon } from "lucide-react";
import { useEffect, useId, useRef, useState, useSyncExternalStore } from "react";
import { Select, SelectContent, SelectGroup, SelectItem, SelectTrigger, SelectValue } from "@nyssance/shadcn/vega/components/ui/select";
import { onSettingsSectionChange, readBundledCliStatus } from "./native.js";
import { desktopSettingsLabels } from "./status-labels.js";
import { resolvedTheme, setThemePreference, subscribeTheme, themePreference } from "./theme.js";
const IS_WINDOWS = typeof navigator !== "undefined" && navigator.platform.includes("Win");
export function AuxWindowShell({
  title,
  showTitleBar = true,
  sidebar,
  sidebarClassName,
  className,
  children
}) {
  return jsxs_eh6c78nj("div", {
    className: cn("bg-background flex h-screen", className),
    children: [
      jsxs_eh6c78nj("aside", {
        className: cn("border-border flex shrink-0 flex-col border-e bg-[#fcfcfc] dark:bg-[#1c1c1c]", sidebarClassName),
        children: [
          !IS_WINDOWS && jsx_w77yafs4("div", {
            className: "h-8 shrink-0",
            "data-tauri-drag-region": true
          }),
          jsx_w77yafs4("div", {
            className: "flex min-h-0 flex-1 flex-col overflow-hidden",
            children: sidebar
          })
        ]
      }),
      jsxs_eh6c78nj("div", {
        className: "flex min-w-0 flex-1 flex-col",
        children: [
          showTitleBar && jsxs_eh6c78nj("div", {
            className: "relative flex h-8 shrink-0 items-center gap-1 ps-2 pe-2",
            "data-tauri-drag-region": true,
            children: [
              title && jsx_w77yafs4("span", {
                className: "text-muted-foreground absolute start-1/2 -translate-x-1/2 text-[13px] font-semibold rtl:translate-x-1/2",
                children: title
              }),
              jsx_w77yafs4("div", {
                className: "h-full flex-1",
                "data-tauri-drag-region": true
              })
            ]
          }),
          jsx_w77yafs4("div", {
            className: "flex min-h-0 flex-1 flex-col",
            children
          })
        ]
      })
    ]
  });
}
export function SettingsLayout({
  sections,
  active,
  onSelect,
  label,
  navigation,
  children
}) {
  const current = sections.find((section) => section.id === active);
  return jsx_w77yafs4(AuxWindowShell, {
    className: "settings-window",
    sidebarClassName: "w-60 [--navigation-row-height:30px]",
    sidebar: jsxs_eh6c78nj("nav", {
      "aria-label": label,
      className: "flex min-h-0 w-full min-w-0 flex-col gap-0.5 overflow-y-auto px-3 pt-5 pb-4 [&>*]:shrink-0",
      children: [
        sections.map(({ id, label, icon: Icon }) => jsxs_eh6c78nj("button", {
          type: "button",
          "data-active": active === id ? "" : undefined,
          "aria-current": active === id ? "page" : undefined,
          onClick: () => onSelect(id),
          className: "group/navigation-row chrome-hover hover:bg-foreground/8 data-active:bg-foreground/5 focus-visible:outline-ring flex h-[30px] w-full items-center gap-1 overflow-hidden rounded-[10px] ps-1 pe-1.5 text-start text-sm outline-hidden [corner-shape:superellipse(1.5)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] disabled:pointer-events-none disabled:opacity-50 [&_svg]:size-4 [&_svg]:shrink-0 [&>span:last-child]:truncate",
          children: [
            jsx_w77yafs4(Icon, {}),
            jsx_w77yafs4("span", {
              children: label
            })
          ]
        }, id)),
        navigation
      ]
    }),
    children: jsx_w77yafs4("div", {
      className: "min-h-0 flex-1 overflow-y-auto px-6 pt-5 pb-10",
      children: jsx_w77yafs4("section", {
        className: "settings-content mx-auto w-full max-w-3xl",
        "aria-label": current?.label,
        children
      })
    })
  });
}
export function SettingLabel({ children }) {
  return jsx_w77yafs4("h2", {
    className: "mb-3 cursor-default text-sm font-medium",
    children
  });
}
export function SettingGroup({ children }) {
  return jsx_w77yafs4("div", {
    className: "settings-group flex w-full min-w-0 flex-col",
    children
  });
}
export function SettingRow({
  title,
  desc,
  children,
  aligned = false
}) {
  const id = useId();
  return jsxs_eh6c78nj("div", {
    role: "group",
    "aria-labelledby": `${id}-title`,
    "aria-describedby": desc ? `${id}-description` : undefined,
    className: cn("settings-row", aligned && "settings-row-aligned"),
    children: [
      jsxs_eh6c78nj("div", {
        className: "settings-row-label min-w-0",
        children: [
          jsx_w77yafs4("div", {
            id: `${id}-title`,
            className: "text-sm leading-5 font-medium",
            children: title
          }),
          desc && jsx_w77yafs4("div", {
            id: `${id}-description`,
            className: "settings-row-description text-muted-foreground mt-1 text-xs leading-5",
            children: desc
          })
        ]
      }),
      children && jsx_w77yafs4("div", {
        className: "settings-row-control",
        children
      })
    ]
  });
}
export function useDesktopTheme() {
  const preference = useSyncExternalStore(subscribeTheme, themePreference, themePreference);
  const theme = useSyncExternalStore(subscribeTheme, resolvedTheme, resolvedTheme);
  return { preference, theme, setPreference: setThemePreference };
}
export function useSettingsSection(sections, fallback = "general", onChange) {
  const latest = useRef(sections);
  latest.current = sections;
  const known = (id) => id !== null && latest.current.some((section) => section.id === id) ? id : null;
  const [section, setSection] = useState(() => known(new URLSearchParams(window.location.search).get("tab")) ?? fallback);
  const changed = useRef(onChange);
  changed.current = onChange;
  useEffect(() => {
    let stop;
    let disposed = false;
    onSettingsSectionChange((id) => {
      const next = known(id);
      if (next === null)
        return;
      setSection(next);
      changed.current?.(next);
    }).then((unlisten) => {
      if (disposed)
        unlisten();
      else
        stop = unlisten;
    }).catch(console.error);
    return () => {
      disposed = true;
      stop?.();
    };
  }, []);
  return [section, setSection];
}
export function useHideOnClose(onError = console.error) {
  useEffect(() => {
    if (!isTauri())
      return;
    let stop;
    let disposed = false;
    import("@tauri-apps/api/webviewWindow").then(async ({ getCurrentWebviewWindow }) => {
      const win = getCurrentWebviewWindow();
      const unlisten = await win.onCloseRequested((event) => {
        event.preventDefault();
        win.hide().catch(onError);
      });
      if (disposed)
        unlisten();
      else
        stop = unlisten;
    }).catch(onError);
    return () => {
      disposed = true;
      stop?.();
    };
  }, [onError]);
}
function PreviewChrome({ dark }) {
  if (!IS_WINDOWS) {
    return jsxs_eh6c78nj("div", {
      className: "flex items-center gap-1 px-2 pt-2",
      children: [
        jsx_w77yafs4("span", {
          className: "size-1.5 shrink-0 rounded-full",
          style: { background: "#ff5f57" }
        }),
        jsx_w77yafs4("span", {
          className: "size-1.5 shrink-0 rounded-full",
          style: { background: "#febc2e" }
        }),
        jsx_w77yafs4("span", {
          className: "size-1.5 shrink-0 rounded-full",
          style: { background: "#28c840" }
        })
      ]
    });
  }
  return jsxs_eh6c78nj("div", {
    className: cn("flex items-center justify-end gap-1 px-2 pt-2", dark ? "text-[#a3a3a3]" : "text-[#737373]"),
    children: [
      jsx_w77yafs4(MinusIcon, {
        className: "size-2",
        strokeWidth: 1
      }),
      jsx_w77yafs4(SquareIcon, {
        className: "size-1.5",
        strokeWidth: 1
      }),
      jsx_w77yafs4(XIcon, {
        className: "size-2",
        strokeWidth: 1
      })
    ]
  });
}
function ThemePreview({ mode, active }) {
  const dark = mode === "dark";
  return jsx_w77yafs4("div", {
    className: cn("relative h-16 w-24 overflow-hidden rounded-lg border-2 transition-colors", active ? "border-ring" : "hover:border-muted-foreground/30 border-transparent"),
    children: mode === "system" ? jsxs_eh6c78nj("div", {
      className: "flex h-full",
      children: [
        jsxs_eh6c78nj("div", {
          className: "flex-1 bg-[#f5f5f5]",
          children: [
            jsx_w77yafs4("div", {
              className: "ms-1.5 mt-2 h-1.5 w-6 rounded-full bg-[#d4d4d4]"
            }),
            jsx_w77yafs4("div", {
              className: "ms-1.5 mt-1 h-1 w-8 rounded-full bg-[#e5e5e5]"
            }),
            jsx_w77yafs4("div", {
              className: "ms-1.5 mt-0.5 h-1 w-5 rounded-full bg-[#e5e5e5]"
            })
          ]
        }),
        jsxs_eh6c78nj("div", {
          className: "flex-1 bg-[#1e1e1e]",
          children: [
            jsx_w77yafs4("div", {
              className: "ms-1.5 mt-2 h-1.5 w-6 rounded-full bg-[#404040]"
            }),
            jsx_w77yafs4("div", {
              className: "ms-1.5 mt-1 h-1 w-8 rounded-full bg-[#333333]"
            }),
            jsx_w77yafs4("div", {
              className: "ms-1.5 mt-0.5 h-1 w-5 rounded-full bg-[#333333]"
            })
          ]
        })
      ]
    }) : jsxs_eh6c78nj("div", {
      className: cn("h-full", dark ? "bg-[#1e1e1e]" : "bg-[#f5f5f5]"),
      children: [
        jsx_w77yafs4(PreviewChrome, {
          dark
        }),
        jsxs_eh6c78nj("div", {
          className: "mt-2 px-2",
          children: [
            jsx_w77yafs4("div", {
              className: cn("h-1.5 w-10 rounded-full", dark ? "bg-[#404040]" : "bg-[#d4d4d4]")
            }),
            jsx_w77yafs4("div", {
              className: cn("mt-1 h-1 w-14 rounded-full", dark ? "bg-[#333333]" : "bg-[#e5e5e5]")
            }),
            jsx_w77yafs4("div", {
              className: cn("mt-0.5 h-1 w-8 rounded-full", dark ? "bg-[#333333]" : "bg-[#e5e5e5]")
            })
          ]
        })
      ]
    })
  });
}
export function ThemeModePicker({
  value,
  onChange,
  labels,
  label
}) {
  const options = ["light", "system", "dark"];
  return jsx_w77yafs4("div", {
    role: "radiogroup",
    "aria-label": label,
    className: "flex items-center gap-2",
    children: options.map((mode) => {
      const active = value === mode;
      return jsxs_eh6c78nj("button", {
        type: "button",
        role: "radio",
        "aria-checked": active,
        onClick: () => onChange(mode),
        className: "focus-visible:[&>div]:border-ring flex cursor-pointer flex-col items-center gap-1.5 outline-none",
        children: [
          jsx_w77yafs4(ThemePreview, {
            mode,
            active
          }),
          jsx_w77yafs4("span", {
            className: cn("text-xs", active ? "text-foreground font-medium" : "text-muted-foreground"),
            children: labels[mode]
          })
        ]
      }, mode);
    })
  });
}
export function AppearanceSection({ language }) {
  const labels = desktopSettingsLabels(language);
  const { preference, setPreference } = useDesktopTheme();
  return jsx_w77yafs4(SettingGroup, {
    children: jsx_w77yafs4(SettingRow, {
      title: labels.theme,
      children: jsx_w77yafs4(ThemeModePicker, {
        value: preference,
        onChange: (next) => void setPreference(next).catch(console.error),
        labels: { light: labels.themeLight, system: labels.themeSystem, dark: labels.themeDark },
        label: labels.theme
      })
    })
  });
}
export function GeneralSection({
  language,
  languages,
  onLanguageChange,
  children
}) {
  const labels = desktopSettingsLabels(language);
  const [version, setVersion] = useState("");
  useEffect(() => {
    if (!isTauri())
      return;
    getVersion().then(setVersion).catch(console.error);
  }, []);
  return jsxs_eh6c78nj(SettingGroup, {
    children: [
      jsx_w77yafs4(SettingRow, {
        title: labels.versionLabel,
        children: jsxs_eh6c78nj("span", {
          className: "text-muted-foreground block text-end text-sm",
          children: [
            "v",
            version
          ]
        })
      }),
      jsx_w77yafs4(SettingRow, {
        title: labels.language,
        aligned: true,
        children: jsxs_eh6c78nj(Select, {
          items: languages.map((item) => ({ value: item.code, label: item.label })),
          value: language,
          onValueChange: (value) => {
            if (typeof value === "string" && value)
              Promise.resolve(onLanguageChange(value)).catch(console.error);
          },
          children: [
            jsx_w77yafs4(SelectTrigger, {
              id: "language",
              className: "w-full",
              "aria-label": labels.language,
              children: jsx_w77yafs4(SelectValue, {})
            }),
            jsx_w77yafs4(SelectContent, {
              align: "start",
              alignItemWithTrigger: false,
              sideOffset: 6,
              className: "max-w-(--available-width) min-w-0 p-1",
              children: jsx_w77yafs4(SelectGroup, {
                children: languages.map((item) => jsx_w77yafs4(SelectItem, {
                  value: item.code,
                  children: item.label
                }, item.code))
              })
            })
          ]
        })
      }),
      children
    ]
  });
}
export function AboutSection({ language, children }) {
  const labels = desktopSettingsLabels(language);
  const [cli, setCli] = useState(null);
  useEffect(() => {
    if (!isTauri())
      return;
    let active = true;
    readBundledCliStatus("codex").then((status) => {
      if (active)
        setCli(status.version);
    }).catch(console.error);
    return () => {
      active = false;
    };
  }, []);
  return jsxs_eh6c78nj(SettingGroup, {
    children: [
      jsx_w77yafs4(SettingRow, {
        title: labels.engine,
        children: jsx_w77yafs4("span", {
          className: "text-muted-foreground text-sm",
          children: labels.codexVersion.replace("{{version}}", cli ?? "—")
        })
      }),
      children
    ]
  });
}
