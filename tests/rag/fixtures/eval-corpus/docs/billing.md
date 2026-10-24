# Billing

## How an invoice total is calculated

The subtotal is the sum of every line (quantity times unit price). The customer discount is a percentage off the subtotal, clamped between 0 and 100. VAT (21%) is added last, and the result is rounded to cents.

## Invoice numbering

Invoice numbers restart every year and are zero-padded to six digits: `2026-000042`. A gap in the sequence is a bug.

## Refunds

A refund is a new invoice with negative lines that references the original number. Refunds never change the original invoice.
