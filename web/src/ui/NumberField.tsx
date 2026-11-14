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

interface InlineNumberFieldProps {
  /** Accessible name; the field shows no label of its own. */
  label: string;
  value: string;
  onChange: (text: string) => void;
  /** Enter, and leaving the field when `commitOnBlur` is set. */
  onCommit: () => void;
  commitOnBlur?: boolean;
  /** Text before and after the number, inside the field ("+", "d"). */
  prefix?: ReactNode;
  suffix?: ReactNode;
  invalid?: boolean;
  /** Width of the number in characters. */
  chars?: number;
  disabled?: boolean;
}

/** One-line number field for toolbars: `+ [ 7 ] d`. Same look as NumberField, no label row. */
export function InlineNumberField({ label, value, onChange, onCommit, commitOnBlur, prefix, suffix, invalid, chars = 2, disabled }: InlineNumberFieldProps) {
  return (
    <span className="field__box field__box--inline" data-invalid={invalid || undefined} data-disabled={disabled || undefined}>
      {prefix ? <span className="field__prefix">{prefix}</span> : null}
      <input
        className="field__input"
        type="text"
        inputMode="numeric"
        autoComplete="off"
        spellCheck={false}
        aria-label={label}
        aria-invalid={invalid || undefined}
        disabled={disabled}
        value={value}
        style={{ width: `${chars + 0.5}ch` }}
        onChange={(event) => onChange(event.target.value)}
        onFocus={(event) => event.target.select()}
        onBlur={() => commitOnBlur && onCommit()}
        onKeyDown={(event) => {
          if (event.key === "Enter") onCommit();
        }}
      />
      {suffix ? <span className="field__suffix">{suffix}</span> : null}
    </span>
  );
}
