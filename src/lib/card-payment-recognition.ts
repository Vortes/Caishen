export function isCardPaymentOutflow(text: string) {
  return (
    /\b(?:payment|autopay|pmt|epay)\b/i.test(text) &&
    /\b(?:card|crd|bankcard|visa|mastercard|amex|american express|discover)\b/i.test(
      text,
    )
  );
}
