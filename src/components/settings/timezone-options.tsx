// The timezones a budget can choose from, with `include` added when it's a
// saved one outside the list.
export function timezoneOptions(include?: string) {
  return [
    ...new Set([
      "America/Los_Angeles",
      "America/Denver",
      "America/Chicago",
      "America/New_York",
      "America/Phoenix",
      "America/Anchorage",
      "Pacific/Honolulu",
      ...(include ? [include] : []),
    ]),
  ].map((timezone) => ({
    value: timezone,
    label: timezone
      .replace("America/", "")
      .replace("Pacific/", "")
      .replaceAll("_", " "),
  }));
}
