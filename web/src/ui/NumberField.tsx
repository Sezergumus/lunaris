import { useId, type ReactNode } from "react";

interface NumberFieldProps {
  label: string;
  /** Unit shown inside the field, after the number. */
  suffix?: ReactNode;
  value: string;
  onChange: (text: string) => void;
  onEnter?: () => void;
  invalid?: boolean;
  placeholder?: string;
}

/**
 * Text field for a decimal number. It is a text input on purpose: no native spinner, and the
 * caller validates with `parseDecimal` (format.ts), so the field looks the same in every browser.
 */
export function NumberField({ label, suffix, value, onChange, onEnter, invalid, placeholder }: NumberFieldProps) {
  const id = useId();
  return (
    <label className="field" htmlFor={id} data-invalid={invalid || undefined}>
      <span className="field__label">{label}</span>
      <span className="field__box">
        <input
          id={id}
          className="field__input"
          type="text"
          inputMode="decimal"
          autoComplete="off"
          spellCheck={false}
          value={value}
          placeholder={placeholder}
          aria-invalid={invalid || undefined}
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") onEnter?.();
          }}
        />
        {suffix ? <span className="field__suffix">{suffix}</span> : null}
      </span>
    </label>
  );
}
