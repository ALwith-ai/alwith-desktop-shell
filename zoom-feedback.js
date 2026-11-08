import { jsx as jsx_w77yafs4, jsxs as jsxs_eh6c78nj } from "react/jsx-runtime";
import { MinusIcon, PlusIcon } from "lucide-react";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import { createPortal } from "react-dom";
import { Button } from "@nyssance/shadcn/vega/components/ui/button";
import { desktopSettingsLabels } from "./status-labels.js";
import {
  resetZoom,
  setZoomLevel,
  subscribeZoom,
  ZOOM_LEVELS,
  zoomIn,
  zoomInteraction,
  zoomLevel,
  zoomOut
} from "./zoom.js";
export function useDesktopZoom() {
  const level = useSyncExternalStore(subscribeZoom, zoomLevel, zoomLevel);
  const interaction = useSyncExternalStore(subscribeZoom, zoomInteraction, zoomInteraction);
  return { level, interaction, levels: ZOOM_LEVELS, setLevel: setZoomLevel, zoomIn, zoomOut, reset: resetZoom };
}
export function ZoomFeedback({
  language,
  showFeedback = true,
  onError = console.error
}) {
  const labels = desktopSettingsLabels(language);
  const { level, interaction } = useDesktopZoom();
  const [dismissed, setDismissed] = useState(interaction);
  const [hovered, setHovered] = useState(false);
  const [keyboardFocus, setKeyboardFocus] = useState(false);
  const keyboard = useRef(false);
  const visible = showFeedback && interaction !== dismissed;
  useEffect(() => {
    const keydown = () => {
      keyboard.current = true;
    };
    const pointerdown = () => {
      keyboard.current = false;
      setKeyboardFocus(false);
    };
    document.addEventListener("keydown", keydown, true);
    document.addEventListener("pointerdown", pointerdown, true);
    return () => {
      document.removeEventListener("keydown", keydown, true);
      document.removeEventListener("pointerdown", pointerdown, true);
    };
  }, []);
  useEffect(() => {
    if (!visible || hovered || keyboardFocus)
      return;
    const timer = setTimeout(() => setDismissed(interaction), 2000);
    return () => clearTimeout(timer);
  }, [visible, interaction, hovered, keyboardFocus]);
  if (!visible)
    return null;
  return createPortal(jsxs_eh6c78nj("fieldset", {
    "aria-label": labels.zoom,
    className: "zoom-feedback bg-popover text-popover-foreground fixed z-50 flex h-12 items-center gap-1 rounded-2xl border px-3 shadow-lg [-webkit-app-region:no-drag]",
    style: { top: 40, right: 12 },
    onPointerEnter: () => setHovered(true),
    onPointerLeave: () => setHovered(false),
    onFocusCapture: () => setKeyboardFocus(keyboard.current),
    onBlurCapture: (event) => {
      if (!event.currentTarget.contains(event.relatedTarget))
        setKeyboardFocus(false);
    },
    children: [
      jsxs_eh6c78nj("span", {
        className: "min-w-12 text-center text-sm font-semibold tabular-nums",
        role: "status",
        "aria-live": "polite",
        children: [
          Math.round(level * 100),
          "%"
        ]
      }),
      jsx_w77yafs4(Button, {
        variant: "ghost",
        size: "icon-sm",
        className: "rounded-lg",
        disabled: level === ZOOM_LEVELS[0],
        "aria-label": labels.zoomOut,
        title: labels.zoomOut,
        onClick: () => void zoomOut().catch(onError),
        children: jsx_w77yafs4(MinusIcon, {})
      }),
      jsx_w77yafs4(Button, {
        variant: "ghost",
        size: "icon-sm",
        className: "rounded-lg",
        disabled: level === ZOOM_LEVELS.at(-1),
        "aria-label": labels.zoomIn,
        title: labels.zoomIn,
        onClick: () => void zoomIn().catch(onError),
        children: jsx_w77yafs4(PlusIcon, {})
      }),
      jsx_w77yafs4("span", {
        "aria-hidden": "true",
        className: "bg-border mx-1 h-5 w-px"
      }),
      jsx_w77yafs4(Button, {
        variant: "ghost",
        size: "sm",
        className: "rounded-lg",
        disabled: level === 1,
        onClick: () => void resetZoom().catch(onError),
        children: labels.actualSize
      })
    ]
  }), document.body);
}
