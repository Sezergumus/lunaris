import { useLayoutEffect, useRef, type ReactNode } from "react";
import { ToggleGroup } from "radix-ui";

export interface SegmentedOption<T extends string> {
  value: T;
  label: ReactNode;
  /** Accessible name when the label is not plain text. */
  ariaLabel?: string;
}

interface SegmentedProps<T extends string> {
  value: T;
  onChange: (value: T) => void;
  options: SegmentedOption<T>[];
  /** Accessible name of the group. */
  label: string;
  size?: "sm" | "md";
}

/**
 * Single-choice segmented control. The highlighted state is a second copy of the labels,
 * clipped to the active segment; moving the clip gives one continuous highlight whose text
 * color changes exactly at its edge.
 */
export function Segmented<T extends string>({ value, onChange, options, label, size = "md" }: SegmentedProps<T>) {
  const rootRef = useRef<HTMLDivElement>(null);
  const activeRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    const root = rootRef.current!;
    const active = activeRef.current!;
    const place = () => {
      const item = root.querySelector<HTMLElement>('[data-state="on"]');
      if (!item) {
        active.style.clipPath = "inset(0 100% 0 0)";
        return;
      }
      const right = root.clientWidth - item.offsetLeft - item.offsetWidth;
      active.style.clipPath = `inset(2px ${right}px 2px ${item.offsetLeft}px round 7px)`;
    };
    place();
    // The first placement must not animate in from nowhere.
    const frame = requestAnimationFrame(() => (active.dataset.ready = "true"));
    const observer = new ResizeObserver(place);
    observer.observe(root);
    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [value, options]);

  return (
    <div ref={rootRef} className={`seg seg--${size}`}>
      <ToggleGroup.Root
        type="single"
        className="seg__list"
        value={value}
        aria-label={label}
        // Radix reports "" when the active item is pressed again; a segmented control keeps its value.
        onValueChange={(next) => next && onChange(next as T)}
      >
        {options.map((option) => (
          <ToggleGroup.Item key={option.value} value={option.value} className="seg__item" aria-label={option.ariaLabel}>
            {option.label}
          </ToggleGroup.Item>
        ))}
      </ToggleGroup.Root>
      <div ref={activeRef} className="seg__list seg__list--active" aria-hidden="true">
        {options.map((option) => (
          <span key={option.value} className="seg__item">
            {option.label}
          </span>
        ))}
      </div>
    </div>
  );
}
