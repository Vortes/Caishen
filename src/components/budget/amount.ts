// Reads an amount a person typed, which may be a calculation, into cents.
export type AmountReading =
  { ok: true; cents: number } | { ok: false; message: string };

const amountMessage = "Enter an amount, such as 84.20 or 600+150.";
const tooLarge = "That amount is too large.";

// An exact fraction; the denominator is always positive.
type Ratio = { n: bigint; d: bigint };

class Unreadable extends Error {}

export function readAmount(text: string): AmountReading {
  const source = text.replace(/[$,\s]/g, "").replace(/−/g, "-");
  let at = 0;

  const fail = (message = amountMessage): never => {
    throw new Unreadable(message);
  };

  const number = (): Ratio => {
    const match = /^\d+(?:\.\d+)?/.exec(source.slice(at));
    if (!match) return fail();
    at += match[0].length;
    const [whole, fraction = ""] = match[0].split(".");
    return reduce({
      n: BigInt(whole + fraction),
      d: 10n ** BigInt(fraction.length),
    });
  };

  const unary = (): Ratio => {
    if (source[at] === "-") {
      at++;
      const value = unary();
      return { n: -value.n, d: value.d };
    }
    if (source[at] === "+") {
      at++;
      return unary();
    }
    return power();
  };

  const power = (): Ratio => {
    const base = group();
    if (source[at] !== "^") return base;
    at++;
    const exponent = unary();
    if (exponent.d !== 1n) fail("Use a whole number after ^.");
    const times = exponent.n < 0n ? -exponent.n : exponent.n;
    // A power too big to work out exactly can't come back to a safe amount
    // of cents; it stops here rather than hang the page.
    const bits = BigInt(Math.max(bitLength(base.n), bitLength(base.d)));
    if (bits > 1n && bits * times > 100_000n) fail(tooLarge);
    const raised = { n: base.n ** times, d: base.d ** times };
    return exponent.n < 0n ? reduce({ n: raised.d, d: raised.n }) : raised;
  };

  const group = (): Ratio => {
    if (source[at] !== "(") return number();
    at++;
    const value = sum();
    if (source[at++] !== ")") fail();
    return value;
  };

  const product = (): Ratio => {
    let total = unary();
    while ("*×/÷".includes(source[at] ?? "x")) {
      const divide = "/÷".includes(source[at++]!);
      const factor = unary();
      total = divide
        ? reduce({ n: total.n * factor.d, d: total.d * factor.n })
        : reduce({ n: total.n * factor.n, d: total.d * factor.d });
    }
    return total;
  };

  const sum = (): Ratio => {
    let total = product();
    while (source[at] === "+" || source[at] === "-") {
      const sign = source[at++] === "-" ? -1n : 1n;
      const term = product();
      total = reduce({
        n: total.n * term.d + sign * term.n * total.d,
        d: total.d * term.d,
      });
    }
    return total;
  };

  try {
    const value = sum();
    if (at !== source.length) fail();
    return { ok: true, cents: toCents(value) };
  } catch (error) {
    if (error instanceof Unreadable)
      return { ok: false, message: error.message };
    throw error;
  }
}

// Whether two amount texts read as the same cents, as when leaving the
// field turns "50,000" into "50,000.00". A screen keeps its error then.
export function sameAmount(a: string, b: string) {
  const [before, after] = [readAmount(a), readAmount(b)];
  return before.ok && after.ok && before.cents === after.cents;
}

// Keeps a fraction in lowest terms with a positive denominator.
function reduce({ n, d }: Ratio): Ratio {
  if (d === 0n) throw new Unreadable("Divide by a number other than zero.");
  if (d < 0n) [n, d] = [-n, -d];
  let [a, b] = [n < 0n ? -n : n, d];
  while (b) [a, b] = [b, a % b];
  return { n: n / a, d: d / a };
}

// Rounds to the nearest cent, half a cent away from zero.
function toCents({ n, d }: Ratio) {
  const negative = n < 0n;
  const size = negative ? -n : n;
  const cents = Number((size * 200n + d) / (2n * d));
  if (!Number.isSafeInteger(cents)) throw new Unreadable(tooLarge);
  return negative && cents ? -cents : cents;
}

function bitLength(value: bigint) {
  return (value < 0n ? -value : value).toString(2).length;
}
