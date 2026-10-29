import { getFirestore, FieldValue } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { logger } from "firebase-functions";
import Stripe from "stripe";
import { payoutSchema, devSettlePayoutSchema } from "./schemas";
import { parse, requireAuth, requireMoneyMover, audit, bumpStats, IS_EMULATOR } from "./middleware";
import { STRIPE_SECRET_KEY } from "./topup";

const DEV_PAYOUTS = IS_EMULATOR;
const APP_URL = process.env.APP_URL ?? "http://localhost:3001";

const stripeClient = () => new Stripe(STRIPE_SECRET_KEY.value());

/** Returns a Stripe-hosted onboarding link where the user links their bank account. */
export const createPayoutAccountLink = onCall({ secrets: [STRIPE_SECRET_KEY] }, async (req) => {
  const { uid, user } = await requireMoneyMover(req);
  if (DEV_PAYOUTS) {
    await getFirestore().doc(`users/${uid}`).update({ payoutAccountId: "dev_account", payoutsEnabled: true });
    return { url: null, dev: true };
  }
  const stripe = stripeClient();
  let accountId = user.payoutAccountId as string | undefined;
  if (!accountId) {
    const account = await stripe.accounts.create(
      { type: "express", email: user.email, capabilities: { transfers: { requested: true } }, metadata: { uid } },
      { idempotencyKey: `acct_${uid}` }
    );
    accountId = account.id;
    await getFirestore().doc(`users/${uid}`).update({ payoutAccountId: accountId, payoutsEnabled: false });
  }
  const link = await stripe.accountLinks.create({
    account: accountId,
    type: "account_onboarding",
    refresh_url: `${APP_URL}/withdraw`,
    return_url: `${APP_URL}/withdraw?linked=1`,
  });
  return { url: link.url, dev: false };
});

export const requestPayout = onCall({ secrets: [STRIPE_SECRET_KEY] }, async (req) => {
  const input = parse(payoutSchema, req.data);
  const { uid, user, limits } = await requireMoneyMover(req);
  if (input.amountCents > limits.perTransaction) {
    throw new HttpsError("resource-exhausted", "Amount exceeds per-transaction limit");
  }
  if (!user.payoutAccountId) throw new HttpsError("failed-precondition", "Link a bank account first");

  if (!DEV_PAYOUTS && !user.payoutsEnabled) {
    const acct = await stripeClient().accounts.retrieve(user.payoutAccountId);
    if (!acct.payouts_enabled) throw new HttpsError("failed-precondition", "Finish bank account setup with Stripe first");
    await getFirestore().doc(`users/${uid}`).update({ payoutsEnabled: true });
  }

  const payoutId = `${uid}_${input.idempotencyKey}`;
  const { replayed } = await holdFunds(uid, payoutId, input.amountCents, user.payoutAccountId);
  if (replayed) return { payoutId, status: (await getFirestore().doc(`payouts/${payoutId}`).get()).data()!.status };
  await audit(uid, "payout.requested", { payoutId, amountCents: input.amountCents });

  if (DEV_PAYOUTS) return { payoutId, status: "pending" };
  try {
    const t = await stripeClient().transfers.create(
      { amount: input.amountCents, currency: "usd", destination: user.payoutAccountId, metadata: { uid, payoutId } },
      { idempotencyKey: payoutId }
    );
    await markPaid(payoutId, t.id);
    return { payoutId, status: "paid" };
  } catch (err) {
    logger.error("Stripe transfer failed", err);
    await failPayout(payoutId, (err as Error).message);
    throw new HttpsError("unavailable", "Withdrawal failed; your funds were returned");
  }
});

/** Debit the wallet up front so the money can't be spent twice while the payout is in flight. */
export async function holdFunds(uid: string, payoutId: string, amountCents: number, accountId: string) {
  const db = getFirestore();
  const payoutRef = db.doc(`payouts/${payoutId}`);
  const walletRef = db.doc(`wallets/${uid}`);
  return db.runTransaction(async (tx) => {
    if ((await tx.get(payoutRef)).exists) return { replayed: true };
    const wallet = await tx.get(walletRef);
    const bal = wallet.data()?.balanceCents as number;
    if (bal < amountCents) throw new HttpsError("failed-precondition", "Insufficient funds");
    const now = FieldValue.serverTimestamp();
    const after = bal - amountCents;
    tx.update(walletRef, { balanceCents: after, version: FieldValue.increment(1), updatedAt: now });
    tx.set(payoutRef, { uid, amountCents, accountId, status: "pending", createdAt: now });
    tx.set(db.doc(`ledger/${payoutId}_payout`), {
      txId: payoutId, uid, type: "payout", amountCents: -amountCents, balanceAfterCents: after,
      note: "Withdrawal to bank", createdAt: now,
    });
    bumpStats(tx, uid, "outCents", amountCents);
    return { replayed: false };
  });
}

export async function markPaid(payoutId: string, stripeTransferId?: string) {
  const db = getFirestore();
  const ref = db.doc(`payouts/${payoutId}`);
  await db.runTransaction(async (tx) => {
    const p = (await tx.get(ref)).data();
    if (!p || p.status !== "pending") return;
    tx.update(ref, { status: "paid", paidAt: FieldValue.serverTimestamp(), ...(stripeTransferId ? { stripeTransferId } : {}) });
    tx.set(db.doc("system/totals"), { paidOutCents: FieldValue.increment(p.amountCents) }, { merge: true });
  });
}

/** Return held funds with a compensating refund entry. Safe to call more than once. */
export async function failPayout(payoutId: string, reason: string) {
  const db = getFirestore();
  const ref = db.doc(`payouts/${payoutId}`);
  await db.runTransaction(async (tx) => {
    const p = (await tx.get(ref)).data();
    if (!p || p.status !== "pending") return;
    const walletRef = db.doc(`wallets/${p.uid}`);
    const after = ((await tx.get(walletRef)).data()!.balanceCents as number) + p.amountCents;
    const now = FieldValue.serverTimestamp();
    tx.update(walletRef, { balanceCents: after, version: FieldValue.increment(1), updatedAt: now });
    tx.update(ref, { status: "failed", failureReason: reason, failedAt: now });
    tx.set(db.doc(`ledger/${payoutId}_reversal`), {
      txId: payoutId, uid: p.uid, type: "refund", amountCents: p.amountCents, balanceAfterCents: after,
      note: "Withdrawal failed — funds returned", createdAt: now,
    });
    bumpStats(tx, p.uid, "outCents", -p.amountCents);
  });
}

/** DEV ONLY: settle a pending payout as the bank would. */
export const devSettlePayout = onCall(async (req) => {
  if (!DEV_PAYOUTS) throw new HttpsError("permission-denied", "Not available");
  const uid = requireAuth(req);
  const { payoutId, outcome } = parse(devSettlePayoutSchema, req.data);
  const p = (await getFirestore().doc(`payouts/${payoutId}`).get()).data();
  if (!p || p.uid !== uid) throw new HttpsError("not-found", "Payout not found");
  if (outcome === "paid") await markPaid(payoutId);
  else await failPayout(payoutId, "Simulated bank rejection");
  return { status: outcome };
});
