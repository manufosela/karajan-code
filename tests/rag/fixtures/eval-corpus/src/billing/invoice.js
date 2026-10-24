// Billing: how an invoice total is computed from its lines, taxes and discounts.
const VAT_RATE = 0.21;

/** Sum the lines, apply the customer discount, then add VAT. Rounded to cents. */
export function computeInvoiceTotal(lines, { discountPercent = 0 } = {}) {
  const subtotal = lines.reduce((acc, l) => acc + l.quantity * l.unitPrice, 0);
  const discounted = applyDiscount(subtotal, discountPercent);
  return Math.round(discounted * (1 + VAT_RATE) * 100) / 100;
}

/** A percentage off the subtotal; never below zero, never above 100%. */
export function applyDiscount(amount, percent) {
  const p = Math.min(100, Math.max(0, percent));
  return amount * (1 - p / 100);
}

/** Invoice numbers are yearly sequences: 2026-000042. */
export function nextInvoiceNumber(year, lastSequence) {
  return `${year}-${String(lastSequence + 1).padStart(6, "0")}`;
}
