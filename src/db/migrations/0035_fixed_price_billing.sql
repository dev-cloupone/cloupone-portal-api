-- Enum: billing type para projetos
CREATE TYPE "public"."billing_type" AS ENUM('hourly', 'fixed_price');

-- Enum: status de parcelas
CREATE TYPE "public"."installment_status" AS ENUM('pending', 'invoiced', 'paid');

-- Enum: tipo de fatura
CREATE TYPE "public"."invoice_type" AS ENUM('hourly', 'fixed_price');

-- Projetos: novos campos
ALTER TABLE "projects" ADD COLUMN "billing_type" "billing_type" NOT NULL DEFAULT 'hourly';
ALTER TABLE "projects" ADD COLUMN "fixed_price_total" numeric(12, 2);

-- Faturas: novo campo
ALTER TABLE "invoices" ADD COLUMN "invoice_type" "invoice_type" NOT NULL DEFAULT 'hourly';

-- Invoice lines: novo valor no enum + novo campo
ALTER TYPE "invoice_line_type" ADD VALUE 'installment';
ALTER TABLE "invoice_lines" ADD COLUMN "installment_id" uuid;

-- Tabela de parcelas
CREATE TABLE "project_installments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "project_id" uuid NOT NULL,
  "installment_number" integer NOT NULL,
  "description" varchar(255),
  "amount" numeric(12, 2) NOT NULL,
  "due_date" date,
  "status" "installment_status" NOT NULL DEFAULT 'pending',
  "invoice_id" uuid,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  CONSTRAINT "project_installments_project_id_projects_id_fk" FOREIGN KEY ("project_id") REFERENCES "projects"("id") ON DELETE CASCADE,
  CONSTRAINT "project_installments_invoice_id_invoices_id_fk" FOREIGN KEY ("invoice_id") REFERENCES "invoices"("id") ON DELETE SET NULL
);

-- FK para invoice_lines -> project_installments
ALTER TABLE "invoice_lines" ADD CONSTRAINT "invoice_lines_installment_id_project_installments_id_fk"
  FOREIGN KEY ("installment_id") REFERENCES "project_installments"("id") ON DELETE SET NULL;

-- Indexes
CREATE INDEX "project_installments_project_idx" ON "project_installments" USING btree ("project_id");
CREATE INDEX "project_installments_status_idx" ON "project_installments" USING btree ("status");
CREATE INDEX "invoice_lines_installment_idx" ON "invoice_lines" USING btree ("installment_id");
CREATE INDEX "invoices_invoice_type_idx" ON "invoices" USING btree ("invoice_type");
