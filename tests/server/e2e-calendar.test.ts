import assert from "node:assert/strict";
import test from "node:test";
import { calendarAt, monthNavigation } from "../e2e/calendar";

void test("a journey captures its budget month in Los Angeles, including the year boundary", () => {
  const instant = new Date("2027-01-01T07:59:59.999Z");
  const calendar = calendarAt(instant);
  assert.deepEqual(calendar, { month: "2026-12", date: "2026-12-01" });
  instant.setTime(Date.parse("2027-01-01T08:00:00Z"));
  assert.deepEqual(calendarAt(instant), {
    month: "2027-01",
    date: "2027-01-01",
  });
  assert.deepEqual(calendar, { month: "2026-12", date: "2026-12-01" });
});

void test("month navigation uses the displayed month rather than a new clock reading", () => {
  assert.deepEqual(monthNavigation("January 2027", "2026-12"), {
    label: "December 2026",
    direction: "Previous month",
    steps: 1,
  });
  assert.deepEqual(monthNavigation("December 2026", "2027-01"), {
    label: "January 2027",
    direction: "Next month",
    steps: 1,
  });
  assert.deepEqual(monthNavigation("December 2026", "2026-12"), {
    label: "December 2026",
    direction: "Next month",
    steps: 0,
  });
  assert.deepEqual(monthNavigation("October 2026", "2026-12"), {
    label: "December 2026",
    direction: "Next month",
    steps: 2,
  });
  assert.throws(() => monthNavigation("Loading", "2026-12"));
  assert.throws(() => monthNavigation("December 2026", "2026-13"));
});
