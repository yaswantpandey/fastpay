import type { Timestamp } from "firebase/firestore";

export type KycStatus = "none" | "pending" | "verified" | "rejected";

export interface UserProfile {
  email: string;
  displayName: string;
  kycStatus: KycStatus;
  mfaEnabled: boolean;
  displayCurrency: string;
  tier: number;
  frozen?: boolean;
  frozenReason?: string;
  payoutAccountId?: string;
  payoutsEnabled?: boolean;
  kycError?: string;
  emailNotifications?: boolean;
  createdAt: Timestamp;
}

export interface Wallet {
  balanceCents: number;
  currency: "USD";
  updatedAt: Timestamp;
  version: number;
}

export type LedgerEntryType =
  | "topup"
  | "transfer_in"
  | "transfer_out"
  | "fee"
  | "refund"
  | "payout"
  | "fx_in"
  | "fx_out"
  | "savings_in"
  | "savings_out"
  | "hold";

export interface LedgerEntry {
  id: string;
  txId: string;
  uid: string;
  type: LedgerEntryType;
  amountCents: number;
  balanceAfterCents: number;
  counterpartyEmail?: string;
  note?: string;
  category?: string;
  createdAt: Timestamp;
}

export interface Transfer {
  fromUid: string;
  toUid: string;
  amountCents: number;
  status: "completed" | "failed";
  note: string;
  idempotencyKey: string;
  createdAt: Timestamp;
}

export interface Topup {
  id: string;
  uid: string;
  stripePaymentIntentId: string;
  method: "card" | "bank";
  amountCents: number;
  status: "pending" | "processing" | "completed" | "failed";
  failureReason?: string;
  createdAt: Timestamp;
}

export interface PaymentRequest {
  id: string;
  requesterUid: string;
  requesterEmail: string;
  payerUid: string;
  payerEmail: string;
  amountCents: number;
  note: string;
  status: "pending" | "paid" | "declined" | "expired";
  expiresAt: Timestamp;
  createdAt: Timestamp;
}

export interface LineItem {
  description: string;
  quantity: number;
  unitPriceCents: number;
}

export interface Invoice {
  id: string;
  number: string;
  issuerUid: string;
  issuerEmail: string;
  issuerName: string;
  recipientEmail: string;
  lineItems: LineItem[];
  totalCents: number;
  memo: string;
  dueDate: Timestamp;
  status: "draft" | "sent" | "overdue" | "paid" | "cancelled";
  createdAt: Timestamp;
}

export interface AppNotification {
  id: string;
  uid: string;
  kind: "transfer_in" | "request" | "invoice" | "schedule_failed" | "kyc" | "hold";
  amountCents: number;
  fromEmail: string;
  note: string;
  read: boolean;
  createdAt: Timestamp;
}

export interface FxRates {
  base: "USD";
  rates: Record<string, number>;
  fetchedAt: Timestamp;
}

export interface Payout {
  id: string;
  uid: string;
  amountCents: number;
  status: "pending" | "paid" | "failed";
  failureReason?: string;
  createdAt: Timestamp;
}

export interface Schedule {
  id: string;
  ownerUid: string;
  toEmail: string;
  amountCents: number;
  note: string;
  frequency: "weekly" | "monthly";
  nextRunAt: Timestamp;
  runCount: number;
  failures: number;
  lastError?: string;
  status: "active" | "paused" | "cancelled";
  createdAt: Timestamp;
}

export interface Split {
  id: string;
  ownerUid: string;
  title: string;
  totalCents: number;
  ownShareCents: number;
  shares: { email: string; amountCents: number }[];
  requestIds: string[];
  createdAt: Timestamp;
}

export interface Contact {
  id: string;
  email: string;
  name: string;
  createdAt?: Timestamp;
}

export interface MonthStat {
  id: string;
  uid: string;
  month: string; // YYYY-MM
  inCents?: number;
  outCents?: number;
}

export interface CurrencyBalance {
  id: string;
  uid: string;
  currency: string;
  balanceMinor: number;
}

export interface Pot {
  id: string;
  uid: string;
  name: string;
  targetCents: number;
  balanceCents: number;
  createdAt: Timestamp;
}

export interface Merchant {
  uid: string;
  businessName: string;
  webhookUrl: string;
  webhookSecret: string;
  enabled: boolean;
}

export interface ApiKey {
  id: string;
  uid: string;
  prefix: string;
  revoked: boolean;
  createdAt: Timestamp;
}

export interface Checkout {
  id: string;
  merchantUid: string;
  amountCents: number;
  description: string;
  reference: string;
  status: "open" | "paid";
  payerEmail?: string;
  expiresAt: Timestamp;
  createdAt: Timestamp;
}

export interface WebhookDelivery {
  id: string;
  type: string;
  checkoutId: string;
  url: string;
  status: "pending" | "delivered" | "failed";
  attempts: number;
  lastStatus?: number;
  lastError?: string;
  createdAt: Timestamp;
}

export interface Hold {
  id: string;
  fromUid: string;
  toEmail: string;
  amountCents: number;
  reasons: string[];
  status: "held" | "approved" | "rejected";
  createdAt: Timestamp;
}
