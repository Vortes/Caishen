/** How two spellings of one person's name compare. */
export const personKey = (name: string) =>
  name.trim().replace(/\s+/g, " ").toLowerCase();
