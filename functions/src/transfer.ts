import { getFirestore, FieldValue, Firestore, DocumentReference, DocumentData } from "firebase-admin/firestore";
import { onCall, HttpsError } from "firebase-functions/v2/https";
import { transferSchema } from "./schemas";
import { parse, requireMoneyMover, audit, dayKey, bumpStats } from "./middleware";
import { evaluateTransferRisk, placeHold } from "./risk";

export interface TransferInput {
  fromUid: string;
  toUid: string;
  fromEmail: string;
  toEmail: string;
  amountCents: number;
  note: string;
  idempotencyKey: string;
  perDayLimit: number;
  /** Set for admin reversals: ledger entries become `refund` and the daily limit is skipped. */
  reversalOf?: string;
  /**
   * Releasing a fraud hold: the sender was already debited (ledger entry `fromHoldEntryId`,
   * daily total and stats) when the hold was placed, so only the recipient side runs here.
   */
  fromHoldEntryId?: string;
}

/**
 * Optional document settled in the same transaction as the transfer
 * (a payment request or invoice). `check` throws if it can't be paid.
 */
export interface SettleHook {
  ref: DocumentReference;
  check: (data: DocumentData | undefined) => void;
  update: Record<string, unknown>;
  /** Also write txId/paidAt onto the hooked doc (default true). */
  stampPayment?: boolean;
}

/**
 * Atomic double-entry P2P transfer. Exported separately so it can be tested
 * directly against the Firestore emulator.
 */
export async function executeTransfer(db: Firestore, t: TransferInput, hook?: SettleHook) {
  // Deterministic id: replaying the same key resolves to the same transfer doc.
  const txId = `${t.fromUid}_${t.idempotencyKey}`;
  const transferRef = db.doc(`transfers/${txId}`);
  const fromWalletRef = db.doc(`wallets/${t.fromUid}`);
  const toWalletRef = db.doc(`wallets/${t.toUid}`);
  const dailyRef = db.doc(`dailyTotals/${t.fromUid}_${dayKey()}`);

  return db.runTransaction(async (tx) => {
    const existing = await tx.get(transferRef);
    if (existing.exists) return { txId, replayed: true };

    if (hook) hook.check((await tx.get(hook.ref)).data());

    const [fromSnap, toSnap, dailySnap] = await Promise.all([
      tx.get(fromWalletRef),
      tx.get(toWalletRef),
      tx.get(dailyRef),
    ]);
    if (!fromSnap.exists || !toSnap.exists) throw new HttpsError("not-found", "Wallet not found");
    const held = !!t.fromHoldEntryId;

    const sentToday = dailySnap.exists ? (dailySnap.data()!.sentCents as number) : 0;
    if (!t.reversalOf && !held && sentToday + t.amountCents > t.perDayLimit) {
      throw new HttpsError("resource-exhausted", "Daily limit exceeded");
    }

    const fromBal = fromSnap.data()!.balanceCents as number;
    const toBal = toSnap.data()!.balanceCents as number;
    if (!held && fromBal < t.amountCents) throw new HttpsError("failed-precondition", "Insufficient funds");

    const now = FieldValue.serverTimestamp();
    const fromAfter = fromBal - t.amountCents;
    const toAfter = toBal + t.amountCents;

    if (!held) {
      tx.update(fromWalletRef, { balanceCents: fromAfter, version: FieldValue.increment(1), updatedAt: now });
      if (!t.reversalOf) tx.set(dailyRef, { sentCents: sentToday + t.amountCents }, { merge: true });
      bumpStats(tx, t.fromUid, "outCents", t.amountCents);
    }
    tx.update(toWalletRef, { balanceCents: toAfter, version: FieldValue.increment(1), updatedAt: now });
    bumpStats(tx, t.toUid, "inCents", t.amountCents);
    const outType = t.reversalOf ? "refund" : "transfer_out";
    const inType = t.reversalOf ? "refund" : "transfer_in";

    tx.set(transferRef, {
      fromUid: t.fromUid,
      toUid: t.toUid,
      participants: [t.fromUid, t.toUid],
      amountCents: t.amountCents,
      status: "completed",
      note: t.note,
      idempotencyKey: t.idempotencyKey,
      ...(t.reversalOf ? { reversalOf: t.reversalOf } : {}),
      createdAt: now,
    });
    if (held) {
      // The hold entry already debited the sender; relabel it so their history shows a normal send.
      tx.update(db.doc(`ledger/${t.fromHoldEntryId}`), { type: "transfer_out", note: t.note, txId });
    } else {
      tx.set(db.doc(`ledger/${txId}_out`), {
        txId, uid: t.fromUid, type: outType, amountCents: -t.amountCents,
        balanceAfterCents: fromAfter, counterpartyEmail: t.toEmail, note: t.note, createdAt: now,
      });
    }
    tx.set(db.doc(`ledger/${txId}_in`), {
      txId, uid: t.toUid, type: inType, amountCents: t.amountCents,
      balanceAfterCents: toAfter, counterpartyEmail: t.fromEmail, note: t.note, createdAt: now,
    });
    tx.set(db.doc(`notifications/${txId}_in`), {
      uid: t.toUid, kind: "transfer_in", amountCents: t.amountCents, fromEmail: t.fromEmail,
      note: t.note, read: false, createdAt: now,
    });
    if (hook) tx.update(hook.ref, hook.stampPayment === false ? hook.update : { ...hook.update, txId, paidAt: now });
    return { txId, replayed: false };
  });
}

export const transfer = onCall(async (req) => {
  const input = parse(transferSchema, req.data);
  const { uid, user, limits } = await requireMoneyMover(req);
  const db = getFirestore();

  if (input.amountCents > limits.perTransaction) {
    throw new HttpsError("resource-exhausted", "Amount exceeds per-transaction limit");
  }
  const toEmail = input.toEmail.toLowerCase();
  if (toEmail === user.email) throw new HttpsError("invalid-argument", "Cannot send to yourself");

  const recipients = await db.collection("users").where("email", "==", toEmail).limit(1).get();
  if (recipients.empty) throw new HttpsError("not-found", "Recipient not found");
  const toUid = recipients.docs[0].id;

  const t: TransferInput = {
    fromUid: uid,
    toUid,
    fromEmail: user.email,
    toEmail,
    amountCents: input.amountCents,
    note: input.note ?? "",
    idempotencyKey: input.idempotencyKey,
    perDayLimit: limits.perDay,
  };
  const id = `${uid}_${input.idempotencyKey}`;
  // A retried request must return the original outcome, not be re-scored by the risk rules.
  const [doneSnap, heldSnap] = await Promise.all([db.doc(`transfers/${id}`).get(), db.doc(`holds/${id}`).get()]);
  if (doneSnap.exists) return { txId: id, status: "completed" };
  if (heldSnap.exists && heldSnap.data()!.status === "held") return { txId: id, status: "held" };

  const risk = await evaluateTransferRisk(uid, user, toUid, input.amountCents);
  if (risk.action === "block") {
    await audit(uid, "transfer.blocked", { toUid, amountCents: input.amountCents, reasons: risk.reasons }, req.rawRequest.ip ?? "");
    throw new HttpsError("permission-denied", `Payment blocked: ${risk.reasons[0]}`);
  }
  if (risk.action === "hold") {
    const h = await placeHold(t, risk.reasons);
    if (!h.replayed) {
      await audit(uid, "transfer.held", { holdId: h.holdId, toUid, amountCents: input.amountCents, reasons: risk.reasons },
        req.rawRequest.ip ?? "");
    }
    return { txId: h.holdId, status: "held" };
  }

  const result = await executeTransfer(db, t);

  if (!result.replayed) {
    await audit(uid, "transfer.sent", { txId: result.txId, toUid, amountCents: input.amountCents },
      req.rawRequest.ip ?? "");
  }
  return { txId: result.txId, status: "completed" };
});
