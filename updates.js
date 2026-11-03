import { jsx as jsx_w77yafs4, jsxs as jsxs_eh6c78nj } from "react/jsx-runtime";
import { ArrowRightIcon, LoaderCircleIcon, RocketIcon } from "lucide-react";
import { useCallback, useEffect, useSyncExternalStore } from "react";
import {
  checkForUpdates,
  confirmDialog,
  getUpdaterState,
  installUpdateAndRelaunch,
  onUpdaterState
} from "./native.js";
import { desktopUpdateLabels } from "./status-labels.js";
import { Button } from "@nyssance/shadcn/vega/components/ui/button";
let state = { type: "uninitialized" };
let started = null;
const listeners = new Set;
const prompted = new Set;
let prompting = false;
let promptLabels = null;
function publish(next) {
  state = next;
  for (const listener of listeners)
    listener();
  if (prompting)
    promptReady();
}
function start() {
  started ??= (async () => {
    let received = false;
    await onUpdaterState((next) => {
      received = true;
      publish(next);
    });
    const initial = await getUpdaterState();
    if (!received)
      publish(initial);
  })().catch((error) => {
    started = null;
    throw error;
  });
  return started;
}
async function confirmInstallAndRelaunch(labels) {
  const confirmed = await confirmDialog({
    title: labels.relaunchTitle,
    message: labels.relaunchDescription,
    ok: labels.relaunchNow,
    cancel: labels.relaunchLater
  });
  if (confirmed)
    await installUpdateAndRelaunch();
}
async function promptReady() {
  if (state.type !== "ready" || prompted.has(state.update.version) || !promptLabels)
    return;
  prompted.add(state.update.version);
  await confirmInstallAndRelaunch(promptLabels);
}
const subscribe = (listener) => {
  listeners.add(listener);
  return () => listeners.delete(listener);
};
const snapshot = () => state;
export function useDesktopUpdater({
  autoPrompt = false,
  labels: labelOverrides,
  onError = console.error
} = {}) {
  const current = useSyncExternalStore(subscribe, snapshot, snapshot);
  const language = typeof navigator === "undefined" ? "en" : navigator.language;
  const labels = { ...desktopUpdateLabels(language), ...labelOverrides };
  useEffect(() => {
    if (autoPrompt) {
      prompting = true;
      promptLabels = labels;
    }
    start().then(() => autoPrompt ? promptReady() : undefined).catch(onError);
  }, [autoPrompt]);
  const check = useCallback(() => checkForUpdates().then(publish), []);
  const relaunch = useCallback(() => confirmInstallAndRelaunch(labels), [labels]);
  return { state: current, labels, check, confirmInstallAndRelaunch: relaunch };
}
export function DesktopUpdateStatus({
  labels: labelOverrides,
  onError = console.error
}) {
  const { state, labels, confirmInstallAndRelaunch } = useDesktopUpdater({
    autoPrompt: true,
    labels: labelOverrides,
    onError
  });
  if (state.type === "downloading") {
    const total = state.totalBytes ?? 0;
    const progress = total > 0 ? Math.min((state.downloadedBytes ?? 0) / total * 100, 100) : 0;
    const label = labels.downloading.replace("{{percent}}", String(Math.round(progress)));
    return jsxs_eh6c78nj("div", {
      className: "flex h-12 w-full items-center gap-2 rounded-xl border bg-card p-2 shadow-lg",
      role: "status",
      children: [
        jsxs_eh6c78nj("svg", {
          role: "progressbar",
          "aria-label": label,
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
          children: label
        })
      ]
    });
  }
  if (state.type === "restarting") {
    return jsxs_eh6c78nj("div", {
      className: "flex h-12 w-full items-center gap-2 rounded-xl border bg-card p-2 shadow-lg",
      role: "status",
      children: [
        jsx_w77yafs4(LoaderCircleIcon, {
          className: "size-8 shrink-0 animate-spin",
          "aria-hidden": "true"
        }),
        jsx_w77yafs4("span", {
          className: "truncate text-sm font-medium text-foreground",
          children: labels.installing
        })
      ]
    });
  }
  if (state.type !== "ready")
    return null;
  return jsxs_eh6c78nj(Button, {
    variant: "outline",
    onClick: () => void confirmInstallAndRelaunch().catch(onError),
    className: "h-12 w-full justify-start gap-2 rounded-xl bg-card p-2 shadow-lg hover:bg-card dark:bg-card dark:hover:bg-card",
    children: [
      jsx_w77yafs4("span", {
        className: "flex size-8 shrink-0 items-center justify-center",
        children: jsx_w77yafs4(RocketIcon, {
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
  });
}
