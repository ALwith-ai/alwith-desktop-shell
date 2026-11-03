import { jsx as jsx_w77yafs4, jsxs as jsxs_eh6c78nj } from "react/jsx-runtime";
import { ArrowRightIcon, LoaderCircleIcon, RocketIcon } from "lucide-react";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import { Button } from "@nyssance/shadcn/vega/components/ui/button";
import {
  checkForUpdates,
  confirmDialog,
  getUpdaterState,
  installUpdateAndRelaunch,
  onUpdaterState
} from "./native.js";
import { desktopUpdateLabels } from "./status-labels.js";
const message = (error) => error instanceof Error ? error.message : String(error);
export function createDesktopUpdater(io) {
  let snapshot = { state: { type: "uninitialized" }, busy: false, error: null, prompt: false };
  let hooks = {};
  let started = null;
  let prompting = false;
  let labels = desktopUpdateLabels((typeof navigator === "undefined" ? undefined : navigator.language) ?? "en");
  const prompted = new Set;
  const listeners = new Set;
  const set = (next) => {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners)
      listener();
  };
  const publish = (state) => {
    const previous = snapshot.state;
    set({ state, ...state.type !== "ready" && !snapshot.busy ? { prompt: false } : {} });
    try {
      hooks.onStateChange?.(state, previous);
    } catch (error) {
      console.error(error);
    }
    if (prompting)
      promptReady().catch(console.error);
  };
  const start = () => {
    started ??= (async () => {
      let received = false;
      let stop;
      try {
        stop = await io.listen((next) => {
          received = true;
          publish(next);
        });
        const initial = await io.getState();
        if (!received)
          publish(initial);
      } catch (error) {
        stop?.();
        started = null;
        throw error;
      }
    })();
    return started;
  };
  const install = async () => {
    const confirmed = snapshot.state;
    if (snapshot.busy || confirmed.type !== "ready")
      return false;
    set({ busy: true, error: null });
    let installed = false;
    try {
      await hooks.prepare?.();
      const current = snapshot.state;
      if (current.type !== "ready" || current.update.version !== confirmed.update.version || current.update.signature !== confirmed.update.signature)
        throw new Error(labels.changed);
      await io.install({ version: confirmed.update.version, signature: confirmed.update.signature });
      installed = true;
    } catch (error) {
      set({ error: message(error) });
    } finally {
      try {
        hooks.finishPreparation?.(installed);
      } finally {
        set({ busy: false, ...installed ? { prompt: false } : {} });
      }
    }
    return installed;
  };
  const confirmInstallAndRelaunch = async () => {
    if (snapshot.state.type !== "ready")
      return false;
    if (!await io.confirm(labels))
      return false;
    return install();
  };
  const requestInstall = async () => {
    if (snapshot.state.type !== "ready")
      return false;
    if (hooks.dialog === "custom") {
      set({ prompt: true, error: null });
      return false;
    }
    return confirmInstallAndRelaunch();
  };
  const promptReady = async () => {
    const state = snapshot.state;
    if (state.type !== "ready" || prompted.has(state.update.version))
      return;
    prompted.add(state.update.version);
    await requestInstall();
  };
  return {
    getSnapshot: () => snapshot,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    configure: (next) => {
      hooks = next;
    },
    setLabels: (next) => {
      labels = next;
    },
    start: async (autoPrompt = false) => {
      if (autoPrompt)
        prompting = true;
      await start();
      if (autoPrompt)
        await promptReady();
    },
    check: async () => publish(await io.check()),
    install,
    confirmInstallAndRelaunch,
    requestInstall,
    dismiss: () => {
      if (!snapshot.busy)
        set({ prompt: false, error: null });
    }
  };
}
const updater = createDesktopUpdater({
  getState: getUpdaterState,
  listen: onUpdaterState,
  check: checkForUpdates,
  install: installUpdateAndRelaunch,
  confirm: (labels) => confirmDialog({
    title: labels.relaunchTitle,
    message: labels.relaunchDescription,
    ok: labels.relaunchNow,
    cancel: labels.relaunchLater
  })
});
export function configureDesktopUpdater(hooks) {
  updater.configure(hooks);
}
export function desktopUpdateStatusText(state, labels) {
  switch (state.type) {
    case "checkingForUpdates":
      return labels.checking;
    case "downloading": {
      const total = state.totalBytes ?? 0;
      const percent = total > 0 ? Math.min(Math.round((state.downloadedBytes ?? 0) / total * 100), 100) : 0;
      return labels.downloading.replace("{{percent}}", String(percent));
    }
    case "availableForDownload":
    case "staging":
      return labels.staging;
    case "ready":
      return labels.ready.replace("{{version}}", state.update.version);
    case "restarting":
      return labels.installing;
    case "disabled":
      return state.reason === "debugBuild" ? labels.disabledDebugBuild ?? labels.disabled : labels.disabled;
    case "uninitialized":
      return labels.disabled;
    default:
      return labels.upToDate;
  }
}
export function useDesktopUpdater({
  autoPrompt = false,
  labels: labelOverrides,
  onError = console.error
} = {}) {
  const current = useSyncExternalStore(updater.subscribe, updater.getSnapshot, updater.getSnapshot);
  const language = (typeof navigator === "undefined" ? undefined : navigator.language) ?? "en";
  const labels = { ...desktopUpdateLabels(language), ...labelOverrides };
  if (autoPrompt)
    updater.setLabels(labels);
  useEffect(() => {
    updater.start(autoPrompt).catch(onError);
  }, [autoPrompt]);
  const check = useCallback(() => updater.check().catch(onError), []);
  const confirmInstallAndRelaunch = useCallback(() => {
    updater.setLabels(labels);
    return updater.confirmInstallAndRelaunch();
  }, [labels]);
  return {
    ...current,
    labels,
    status: desktopUpdateStatusText(current.state, labels),
    check,
    install: updater.install,
    confirmInstallAndRelaunch,
    requestInstall: updater.requestInstall,
    dismiss: updater.dismiss
  };
}
const card = "flex h-12 w-full items-center gap-2 rounded-xl border bg-card p-2 shadow-lg";
export function DesktopUpdateStatus({
  labels: labelOverrides,
  onError = console.error
}) {
  const { state, busy, error, labels, status, confirmInstallAndRelaunch } = useDesktopUpdater({
    autoPrompt: true,
    labels: labelOverrides,
    onError
  });
  if (state.type === "downloading") {
    const total = state.totalBytes ?? 0;
    const progress = total > 0 ? Math.min((state.downloadedBytes ?? 0) / total * 100, 100) : 0;
    return jsxs_eh6c78nj("div", {
      className: card,
      role: "status",
      children: [
        jsxs_eh6c78nj("svg", {
          role: "progressbar",
          "aria-label": status,
          "aria-valuemin": 0,
          "aria-valuemax": 100,
          "aria-valuenow": Math.round(progress),
          viewBox: "0 0 24 24",
          className: "size-8 shrink-0 -rotate-90",
          children: [
            jsx_w77yafs4("circle", {
              cx: "12",
              cy: "12",
              r: "9",
              pathLength: "100",
              fill: "none",
              className: "stroke-muted",
              strokeWidth: "2"
            }),
            jsx_w77yafs4("circle", {
              cx: "12",
              cy: "12",
              r: "9",
              pathLength: "100",
              fill: "none",
              className: "stroke-foreground",
              strokeWidth: "2",
              strokeLinecap: "round",
              strokeDasharray: "100",
              strokeDashoffset: 100 - progress
            })
          ]
        }),
        jsx_w77yafs4("span", {
          className: "truncate text-sm font-medium text-foreground",
          children: status
        })
      ]
    });
  }
  if (state.type === "staging" || state.type === "restarting") {
    return jsxs_eh6c78nj("div", {
      className: card,
      role: "status",
      children: [
        jsx_w77yafs4(LoaderCircleIcon, {
          className: "size-8 shrink-0 animate-spin",
          "aria-hidden": "true"
        }),
        jsx_w77yafs4("span", {
          className: "truncate text-sm font-medium text-foreground",
          children: status
        })
      ]
    });
  }
  if (state.type !== "ready")
    return null;
  return jsxs_eh6c78nj("div", {
    className: "flex w-full flex-col gap-1",
    children: [
      jsxs_eh6c78nj(Button, {
        variant: "outline",
        disabled: busy,
        onClick: () => void confirmInstallAndRelaunch().catch(onError),
        className: "h-12 w-full justify-start gap-2 rounded-xl bg-card p-2 shadow-lg hover:bg-card dark:bg-card dark:hover:bg-card",
        children: [
          jsx_w77yafs4("span", {
            className: "flex size-8 shrink-0 items-center justify-center",
            children: busy ? jsx_w77yafs4(LoaderCircleIcon, {
              className: "size-6 animate-spin"
            }) : jsx_w77yafs4(RocketIcon, {
              className: "size-6"
            })
          }),
          jsxs_eh6c78nj("span", {
            className: "min-w-0 flex-1 truncate text-start",
            children: [
              jsx_w77yafs4("span", {
                className: "block truncate text-sm font-medium text-foreground",
                children: labels.install
              }),
              jsxs_eh6c78nj("span", {
                className: "block truncate text-xs font-normal text-muted-foreground",
                children: [
                  "v",
                  state.update.version
                ]
              })
            ]
          }),
          jsx_w77yafs4(ArrowRightIcon, {
            className: "size-4 shrink-0 text-muted-foreground rtl:-scale-x-100"
          })
        ]
      }),
      error && jsx_w77yafs4("p", {
        role: "alert",
        className: "px-2 text-xs text-destructive",
        children: error
      })
    ]
  });
}
