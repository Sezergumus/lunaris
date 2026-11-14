import { Slider as RadixSlider } from "radix-ui";

interface SliderProps {
  value: number;
  onChange: (value: number) => void;
  /** Called when the user lets go of the thumb. */
  onCommit?: (value: number) => void;
  min: number;
  max: number;
  step?: number;
  /** Accessible name of the thumb. */
  label: string;
  /** Text read by screen readers instead of the bare number. */
  valueText?: string;
  disabled?: boolean;
  className?: string;
}

export function Slider({ value, onChange, onCommit, min, max, step = 1, label, valueText, disabled, className }: SliderProps) {
  return (
    <RadixSlider.Root
      className={`slider${className ? ` ${className}` : ""}`}
      value={[value]}
      onValueChange={([next]) => onChange(next)}
      onValueCommit={onCommit ? ([next]) => onCommit(next) : undefined}
      min={min}
      max={max}
      step={step}
      disabled={disabled}
    >
      <RadixSlider.Track className="slider__track">
        <RadixSlider.Range className="slider__range" />
      </RadixSlider.Track>
      <RadixSlider.Thumb className="slider__thumb" aria-label={label} aria-valuetext={valueText} />
    </RadixSlider.Root>
  );
}
