export function calendarAt(instant: Date) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Los_Angeles",
    year: "numeric",
    month: "2-digit",
  }).formatToParts(instant);
  const month = `${parts.find((part) => part.type === "year")!.value}-${parts.find((part) => part.type === "month")!.value}`;
  return { month, date: `${month}-01` };
}

const months = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];
export const monthLabelPattern = new RegExp(`^(${months.join("|")}) \\d{4}$`);

export function monthNavigation(displayed: string, target: string) {
  if (
    !monthLabelPattern.test(displayed) ||
    !/^\d{4}-(0[1-9]|1[0-2])$/.test(target)
  )
    throw new Error("Expected an English month label and an ISO budget month.");
  const [name, shownYear] = displayed.split(" ");
  const [year, month] = target.split("-").map(Number);
  const offset =
    (year! - Number(shownYear)) * 12 + month! - 1 - months.indexOf(name!);
  return {
    label: `${months[month! - 1]} ${year}`,
    direction: offset < 0 ? "Previous month" : "Next month",
    steps: Math.abs(offset),
  };
}
