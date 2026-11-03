import { jsx as jsx_w77yafs4, jsxs as jsxs_eh6c78nj } from "react/jsx-runtime";
import { cn } from "cn";
import { Button } from "@nyssance/shadcn/vega/components/ui/button";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyssance/shadcn/vega/components/ui/tooltip";
export function LeadingNavigation({ label, items, activePage, children }) {
  return jsxs_eh6c78nj("nav", {
    "aria-label": label,
    className: "leading-navigation",
    children: [
      items.map(({ id, label, icon: Icon, onClick }) => jsxs_eh6c78nj(Tooltip, {
        children: [
          jsx_w77yafs4(TooltipTrigger, {
            render: jsx_w77yafs4(Button, {
              variant: "ghost",
              size: "icon",
              "aria-label": label,
              "aria-current": activePage === id ? "page" : undefined,
              onClick,
              className: cn("text-muted-foreground hover:text-foreground aria-[current=page]:bg-foreground/5 aria-[current=page]:text-foreground size-9 rounded-[10px] motion-reduce:transition-none"),
              children: jsx_w77yafs4(Icon, {
                "aria-hidden": "true",
                className: "size-[18px]"
              })
            })
          }),
          jsx_w77yafs4(TooltipContent, {
            side: "inline-end",
            children: label
          })
        ]
      }, id)),
      children
    ]
  });
}
