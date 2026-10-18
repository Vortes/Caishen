export function TimezoneOptions() {
  return (
    <>
      {[
        "America/Los_Angeles",
        "America/Denver",
        "America/Chicago",
        "America/New_York",
        "America/Phoenix",
        "America/Anchorage",
        "Pacific/Honolulu",
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
