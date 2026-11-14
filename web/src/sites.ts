// Display helpers for site names such as "Malapert A / IM-1 Odysseus" or "Chandrayaan-3 (Shiv Shakti)".

const NAME_PATTERN = /^(.*?)\s*(?:\/\s*(.+)|\((.+)\))$/;

/** Primary part of a site name: "Malapert A". */
export function siteTitle(name: string): string {
  return NAME_PATTERN.exec(name)?.[1] ?? name;
}

/** Secondary part of a site name, if any: "IM-1 Odysseus". */
export function siteSubtitle(name: string): string | null {
  const match = NAME_PATTERN.exec(name);
  return match ? (match[2] ?? match[3] ?? null) : null;
}
