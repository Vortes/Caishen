import {
  AccountingError,
  commandSchema,
  type Budget,
  type Command,
} from "~/domain/engine";

export function budgetDay(timezone: string, now = new Date()): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const part = (type: Intl.DateTimeFormatPartTypes) =>
    parts.find((value) => value.type === type)!.value;
  return `${part("year")}-${part("month")}-${part("day")}`;
}

export function prepareUserCommand(
  budget: Pick<Budget, "startMonth" | "settings">,
  input: Command,
  now = new Date(),
): Command {
  const command = commandSchema.parse(input);
  const today = budgetDay(budget.settings.timezone, now);
  const datedActivity = [
    "transaction.upsert",
    "transaction.save",
    "card.payment",
    "card.credit",
    "reimbursement.receive",
    "counterparty.receive",
    "partner.edit",
    "partner.record",
    "partner.match",
    "loan.payment",
    "settlement.record",
    "settlement.receive",
    "account.add",
  ].includes(command.type);
  const date =
    command.type === "account.add"
      ? (command.date ?? `${budget.startMonth}-01`)
      : "date" in command
        ? command.date
        : undefined;
  if (datedActivity && date && date > today)
    throw new AccountingError(
      "Record confirmed activity on or before today in your budget's timezone. Future activity cannot create or consume available cash.",
    );
  if (
    command.type === "transaction.save" ||
    command.type === "transaction.upsert" ||
    command.type === "counterparty.receive" ||
    command.type === "partner.edit" ||
    command.type === "partner.record" ||
    command.type === "partner.match" ||
    command.type === "transaction.merge" ||
    command.type === "transaction.remove" ||
    command.type === "transaction.reject" ||
    command.type === "transaction.categorize" ||
    command.type === "transaction.categorize.batch"
  )
    return { ...command, recordedAt: now.toISOString() };
  return command.type === "target.snooze"
    ? { ...command, currentMonth: today.slice(0, 7) }
    : command;
}
