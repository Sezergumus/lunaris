/** Rows of the visibility strips, top to bottom. */
export const STRIP_ROWS = [
  { id: "sun", label: "Sun" },
  { id: "link", label: "Earth link" },
  { id: "both", label: "Sun + link" },
] as const;

export type StripRowId = (typeof STRIP_ROWS)[number]["id"];
