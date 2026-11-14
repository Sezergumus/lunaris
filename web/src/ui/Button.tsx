import type { ButtonHTMLAttributes, Ref } from "react";
import { Tip } from "./Tooltip.tsx";

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  /** `plain` has no fill until hovered, `filled` is a neutral chip, `accent` is the primary action. */
  variant?: "plain" | "filled" | "accent";
  size?: "sm" | "md";
  ref?: Ref<HTMLButtonElement>;
};

export function Button({ variant = "filled", size = "md", className, type = "button", ...rest }: ButtonProps) {
  return <button type={type} className={`btn btn--${variant} btn--${size}${className ? ` ${className}` : ""}`} {...rest} />;
}

type IconButtonProps = Omit<ButtonProps, "aria-label"> & {
  /** Accessible name, also shown as the tooltip. */
  label: string;
  tipSide?: "top" | "right" | "bottom" | "left";
};

/** Square button holding a single icon; the label doubles as its tooltip. */
export function IconButton({ label, tipSide, className, ...rest }: IconButtonProps) {
  return (
    <Tip label={label} side={tipSide}>
      <Button aria-label={label} className={`btn--icon${className ? ` ${className}` : ""}`} {...rest} />
    </Tip>
  );
}
