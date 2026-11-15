import { useEffect, useState } from "react";
import { Check, Link } from "lucide-react";
import { IconButton } from "../ui/Button.tsx";

const FEEDBACK_MS = 1600;

/** Copies through a hidden, selected text field: older browsers and refused permissions. */
function copyWithSelection(text: string): boolean {
  const field = document.createElement("textarea");
  field.value = text;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.append(field);
  field.select();
  try {
    return document.execCommand("copy");
  } catch {
    return false;
  } finally {
    field.remove();
  }
}

/**
 * Copies the address of the scenario on screen. The address bar always holds the whole
 * scenario (state/url.ts), so the link opens the same view for a teammate.
 */
export function CopyLink() {
  const [result, setResult] = useState<"copied" | "failed" | null>(null);

  useEffect(() => {
    if (!result) return;
    const timer = setTimeout(() => setResult(null), FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [result]);

  const copy = () => {
    const url = window.location.href;
    // The Clipboard API needs permission and a secure page; the older path covers the rest.
    const clipboard = navigator.clipboard?.writeText(url) ?? Promise.reject(new Error("No Clipboard API"));
    clipboard.then(
      () => setResult("copied"),
      () => setResult(copyWithSelection(url) ? "copied" : "failed"),
    );
  };

  const label = result === "copied" ? "Link copied" : result === "failed" ? "Could not copy; use the address bar" : "Copy a link to this scenario";
  return (
    <IconButton label={label} variant="plain" size="sm" tipSide="bottom" onClick={copy} data-copied={result === "copied" || undefined}>
      {result === "copied" ? <Check aria-hidden="true" /> : <Link aria-hidden="true" />}
    </IconButton>
  );
}
