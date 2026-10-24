// Tax rates per country and the reverse-charge rule for EU businesses.
const RATES = { ES: 0.21, FR: 0.2, DE: 0.19, PT: 0.23 };

/** The VAT rate of a country, or an error: an unknown country is never taxed at zero by accident. */
export function vatRateFor(country) {
  const rate = RATES[country];
  if (rate === undefined) throw new Error(`no VAT rate for ${country}`);
  return rate;
}

/** EU business customers with a valid VAT id pay no VAT here: the buyer self-assesses it. */
export function reverseChargeApplies(customer) {
  return customer.isBusiness && Boolean(customer.vatId) && customer.country !== "ES";
}

/** The tax amount of a subtotal, zero under reverse charge. */
export function taxAmount(subtotal, customer) {
  if (reverseChargeApplies(customer)) return 0;
  return Math.round(subtotal * vatRateFor(customer.country) * 100) / 100;
}
