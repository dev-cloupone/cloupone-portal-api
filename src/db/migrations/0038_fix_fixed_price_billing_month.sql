-- Fix fixed_price invoices: billing should equal reference month (not ref + 1)
-- Parcelas de contrato sao cobradas no mesmo mes, nao no mes seguinte
UPDATE "invoices"
SET "billing_year" = "year",
    "billing_month" = "month"
WHERE "invoice_type" = 'fixed_price';
