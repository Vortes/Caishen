export function TimezoneOptions({ include }: { include?: string } = {}) {
  return (
    <>
      {[
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
      ].map((timezone) => (
        <option key={timezone} value={timezone}>
          {timezone
            .replace("America/", "")
            .replace("Pacific/", "")
            .replaceAll("_", " ")}
        </option>
      ))}
    </>
  );
}
