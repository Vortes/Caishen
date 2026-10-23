import type { Budget, Transaction, TransactionLine } from "./engine";
import { counterpartyLines } from "./counterparty";
import { canonicalJson } from "./canonical-json";

export function refundOrder(a: Transaction, b: Transaction): number {
  return a.date.localeCompare(b.date) || a.id.localeCompare(b.id);
}

export function proportionalRefundLines(original: Transaction, previousAmount: number, refundAmount: number): TransactionLine[] {
  const originalLines = counterpartyLines(original);
  if (!originalLines.length || original.amount >= 0) return [];
  const allocate = (amount: number) => {
    const parts = originalLines.map(line => ({ id: line.id, amount: Number(BigInt(-line.amount) * BigInt(amount) / BigInt(-original.amount)) }));
    const largest = parts.reduce((a, b) => Math.abs(a.amount) >= Math.abs(b.amount) ? a : b);
    largest.amount += amount - parts.reduce((total, part) => total + part.amount, 0);
    return new Map(parts.map(part => [part.id, part.amount]));
  };
  const previous = allocate(previousAmount);
  const cumulative = allocate(previousAmount + refundAmount);
  return originalLines.flatMap(line => {
    const before = previous.get(line.id)!;
    const after = cumulative.get(line.id)!;
    const amount = after - before;
    if (!amount) return [];
    const share = line.counterpartyShare;
    const shareAmount = share ? Math.abs(Number(BigInt(share.amount) * BigInt(Math.abs(after)) / BigInt(Math.abs(line.amount))) - Number(BigInt(share.amount) * BigInt(Math.abs(before)) / BigInt(Math.abs(line.amount)))) : 0;
    return [{ id: line.id, categoryId: line.categoryId, amount, ...(share ? { counterpartyShare: { ...share, amount: shareAmount } } : {}) }];
  });
}

export function linkedRefundIssues(budget: Pick<Budget, "transactions">): string[] {
  const active = budget.transactions.filter(transaction => !transaction.removed);
  const byId = new Map(active.map(transaction => [transaction.id, transaction]));
  const groups = new Map<string, Transaction[]>();
  for (const refund of active) {
    if (!refund.refundOfTransactionId) continue;
    const source = byId.get(refund.refundOfTransactionId);
    if (!source || source.id === refund.id || source.kind !== "purchase" || source.amount >= 0 || refund.kind !== "refund" || refund.amount <= 0 || refund.date < source.date)
      return ["Invalid linked refund source"];
    const refunds = groups.get(source.id) ?? [];
    refunds.push(refund);
    groups.set(source.id, refunds);
  }
  const signature = (lines: TransactionLine[]) => lines.map(line => ({ categoryId: line.categoryId, amount: line.amount, counterpartyShare: line.counterpartyShare ?? null }));
  for (const [sourceId, refunds] of groups) {
    const source = byId.get(sourceId)!;
    let previous = 0;
    for (const refund of refunds.sort(refundOrder)) {
      if (refund.amount > -source.amount - previous) return ["Linked refunds exceed their purchase"];
      const expected = proportionalRefundLines(source, previous, refund.amount);
      if (!expected.length || canonicalJson(signature(expected)) !== canonicalJson(signature(counterpartyLines(refund))))
        return ["Linked refund allocation differs from its purchase"];
      previous += refund.amount;
    }
  }
  return [];
}
