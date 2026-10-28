import { z } from "zod";

// Keep in sync with src/lib/schemas.ts. All money is integer cents.
export const amountCentsSchema = z.number().int().positive().max(1_000_000);

export const transferSchema = z.object({
  toEmail: z.string().email(),
  amountCents: amountCentsSchema,
  note: z.string().max(200).default(""),
  idempotencyKey: z.string().uuid(),
});

export const topupSchema = z.object({
  amountCents: z.number().int().min(100).max(500_000),
  method: z.enum(["card", "bank"]),
  idempotencyKey: z.string().uuid(),
});

export const createRequestSchema = z.object({
  payerEmail: z.string().email(),
  amountCents: amountCentsSchema,
  note: z.string().max(200).default(""),
});

export const respondRequestSchema = z.object({
  requestId: z.string().min(1).max(200),
  action: z.enum(["pay", "decline"]),
});

export const lineItemSchema = z.object({
  description: z.string().min(1).max(200),
  quantity: z.number().int().min(1).max(1000),
  unitPriceCents: z.number().int().min(1).max(1_000_000),
});

export const createInvoiceSchema = z.object({
  recipientEmail: z.string().email(),
  lineItems: z.array(lineItemSchema).min(1).max(50),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  memo: z.string().max(500).default(""),
  send: z.boolean(),
});

export const invoiceActionSchema = z.object({
  invoiceId: z.string().min(1).max(200),
  action: z.enum(["send", "cancel", "pay", "pdf"]),
});

export const invoiceTotal = (items: z.infer<typeof lineItemSchema>[]) =>
  items.reduce((s, i) => s + i.quantity * i.unitPriceCents, 0);

export const payoutSchema = z.object({
  amountCents: z.number().int().min(100).max(1_000_000),
  idempotencyKey: z.string().uuid(),
});

export const devSettlePayoutSchema = z.object({
  payoutId: z.string().min(1).max(200),
  outcome: z.enum(["paid", "failed"]),
});

export const createScheduleSchema = z.object({
  toEmail: z.string().email(),
  amountCents: amountCentsSchema,
  note: z.string().max(200).default(""),
  frequency: z.enum(["weekly", "monthly"]),
  startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
});

export const scheduleActionSchema = z.object({
  scheduleId: z.string().min(1).max(200),
  action: z.enum(["pause", "resume", "cancel"]),
});

export const createSplitSchema = z.object({
  title: z.string().min(1).max(100),
  totalCents: amountCentsSchema,
  // Shares are explicit so the server never has to guess how to distribute remainder cents.
  shares: z.array(z.object({ email: z.string().email(), amountCents: amountCentsSchema })).min(1).max(20),
});

export const adminUserActionSchema = z.object({
  uid: z.string().min(1).max(128),
  action: z.enum(["freeze", "unfreeze"]),
  reason: z.string().min(1).max(500),
});

export const adminReverseSchema = z.object({
  txId: z.string().min(1).max(300),
  reason: z.string().min(1).max(500),
});

export const adminSearchSchema = z.object({
  email: z.string().max(200).default(""),
});

export const adminSetTierSchema = z.object({
  uid: z.string().min(1).max(128),
  tier: z.number().int().min(0).max(2),
  reason: z.string().min(1).max(500),
});

export const devKycSchema = z.object({ outcome: z.enum(["verified", "rejected"]) });

// Keep in sync with CURRENCIES in fx.ts / src/lib/format.ts.
export const currencySchema = z.enum(["USD", "EUR", "GBP", "INR", "JPY", "CAD", "AUD"]);

export const convertSchema = z.object({
  from: currencySchema,
  to: currencySchema,
  // Minor units of the source currency (JPY has none, so "cents" are whole yen there).
  amountMinor: z.number().int().positive().max(100_000_000),
  idempotencyKey: z.string().uuid(),
  // Rate the user saw; the server refuses if the live rate moved against them by more than 1%.
  quotedRate: z.number().positive(),
});

export const createPotSchema = z.object({
  name: z.string().min(1).max(60),
  targetCents: z.number().int().min(0).max(100_000_000),
});

export const potMoveSchema = z.object({
  potId: z.string().min(1).max(200),
  direction: z.enum(["in", "out"]),
  amountCents: amountCentsSchema,
  idempotencyKey: z.string().uuid(),
});

export const potIdSchema = z.object({ potId: z.string().min(1).max(200) });

export const merchantProfileSchema = z.object({
  businessName: z.string().min(1).max(100),
  // https only in production; the emulator also allows http://localhost for testing receivers.
  webhookUrl: z.string().url().max(500).or(z.literal("")),
});

export const createCheckoutSchema = z.object({
  amountCents: amountCentsSchema,
  description: z.string().min(1).max(200),
  reference: z.string().max(100).default(""),
  successUrl: z.string().url().max(500).optional(),
});

export const checkoutIdSchema = z.object({ checkoutId: z.string().min(1).max(200) });

export const apiKeyActionSchema = z.object({ keyId: z.string().min(1).max(200) });

export const holdDecisionSchema = z.object({
  holdId: z.string().min(1).max(300),
  decision: z.enum(["approve", "reject"]),
  reason: z.string().min(1).max(500),
});
