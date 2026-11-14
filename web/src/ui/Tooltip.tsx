import type { ReactNode } from "react";
import { Tooltip } from "radix-ui";

/**
 * One provider for the whole app: the first tooltip waits, neighbours hovered right after it
 * open at once (and without animation, see `data-state="instant-open"` in ui.css).
 */
export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <Tooltip.Provider delayDuration={450} skipDelayDuration={400}>
      {children}
    </Tooltip.Provider>
  );
}

interface TipProps {
  label: ReactNode;
  side?: "top" | "right" | "bottom" | "left";
  children: ReactNode;
}

export function Tip({ label, side = "top", children }: TipProps) {
  return (
    <Tooltip.Root>
      <Tooltip.Trigger asChild>{children}</Tooltip.Trigger>
      <Tooltip.Portal>
        <Tooltip.Content className="tip" side={side} sideOffset={6} collisionPadding={8}>
          {label}
        </Tooltip.Content>
      </Tooltip.Portal>
    </Tooltip.Root>
  );
}
