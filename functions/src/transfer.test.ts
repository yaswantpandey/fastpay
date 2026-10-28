/**
 * Ledger invariant tests. Run against the Firestore emulator:
 *   firebase emulators:exec --only firestore "npm --prefix functions test"
 */
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { initializeApp, getApps } from "firebase-admin/app";
import { getFirestore, Firestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";
import { executeTransfer, TransferInput } from "./transfer";

let db: Firestore;

beforeAll(() => {
  if (!process.env.FIRESTORE_EMULATOR_HOST) throw new Error("Run with the Firestore emulator");
  if (getApps().length === 0) initializeApp({ projectId: "demo-fastpay" });
  db = getFirestore();
});

async function clear() {
  for (const c of ["wallets", "ledger", "transfers", "dailyTotals", "notifications", "paymentRequests"]) {
    const snap = await db.collection(c).get();
    await Promise.all(snap.docs.map((d) => d.ref.delete()));
  }
}

async function seed(balances: Record<string, number>) {
  await Promise.all(
    Object.entries(balances).map(([uid, balanceCents]) =>
      db.doc(`wallets/${uid}`).set({ balanceCents, currency: "USD", version: 0 })
    )
  );
}

const bal = async (uid: string) => (await db.doc(`wallets/${uid}`).get()).data()!.balanceCents as number;

const input = (o: Partial<TransferInput> = {}): TransferInput => ({
  fromUid: "alice", toUid: "bob", fromEmail: "a@x.com", toEmail: "b@x.com",
  amountCents: 1_000, note: "", idempotencyKey: randomUUID(), perDayLimit: 1_000_000, ...o,
});

describe("executeTransfer", () => {
  beforeEach(async () => {
    await clear();
    await seed({ alice: 10_000, bob: 0 });
  });

  it("moves funds and writes exactly one debit and one equal credit", async () => {
    const { txId } = await executeTransfer(db, input({ amountCents: 2_500 }));
    expect(await bal("alice")).toBe(7_500);
    expect(await bal("bob")).toBe(2_500);

    const entries = (await db.collection("ledger").where("txId", "==", txId).get()).docs.map((d) => d.data());
    expect(entries).toHaveLength(2);
    expect(entries.reduce((s, e) => s + e.amountCents, 0)).toBe(0);
  });

  it("never creates a second transfer when the idempotency key is replayed", async () => {
    const key = randomUUID();
    await executeTransfer(db, input({ idempotencyKey: key }));
    const second = await executeTransfer(db, input({ idempotencyKey: key }));
    expect(second.replayed).toBe(true);
    expect(await bal("alice")).toBe(9_000);
    expect((await db.collection("transfers").get()).size).toBe(1);
  });

  it("rejects insufficient funds and never goes negative", async () => {
    await expect(executeTransfer(db, input({ amountCents: 10_001 }))).rejects.toThrow(/Insufficient/);
    expect(await bal("alice")).toBe(10_000);
  });

  it("enforces the daily limit", async () => {
    await executeTransfer(db, input({ amountCents: 3_000, perDayLimit: 5_000 }));
    await expect(executeTransfer(db, input({ amountCents: 3_000, perDayLimit: 5_000 }))).rejects.toThrow(/Daily limit/);
  });

  it("conserves total funds under concurrent transfers", async () => {
    await seed({ alice: 10_000, bob: 10_000 });
    const ops = Array.from({ length: 20 }, (_, i) =>
      executeTransfer(db, i % 2
        ? input({ amountCents: 700 })
        : input({ fromUid: "bob", toUid: "alice", amountCents: 900 })
      ).catch(() => null)
    );
    await Promise.all(ops);
    const a = await bal("alice");
    const b = await bal("bob");
    expect(a + b).toBe(20_000);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(b).toBeGreaterThanOrEqual(0);
  });

  it("settles a request exactly once even when paid twice concurrently", async () => {
    const ref = db.doc("paymentRequests/r1");
    await ref.set({ payerUid: "alice", status: "pending" });
    const hook = {
      ref,
      check: (cur: FirebaseFirestore.DocumentData | undefined) => {
        if (cur?.status !== "pending") throw new Error(`Request is ${cur?.status}`);
      },
      update: { status: "paid" },
    };
    const pay = () => executeTransfer(db, input({ amountCents: 4_000, idempotencyKey: "req_r1" }), hook);
    const results = await Promise.all([pay(), pay()]);
    expect(results.filter((r) => !r.replayed)).toHaveLength(1);
    expect(await bal("alice")).toBe(6_000);
    expect((await ref.get()).data()!.status).toBe("paid");
  });

  it("does not move money when the settle check fails", async () => {
    const ref = db.doc("paymentRequests/r2");
    await ref.set({ status: "declined" });
    await expect(executeTransfer(db, input(), {
      ref,
      check: (cur) => { if (cur?.status !== "pending") throw new Error("Request is declined"); },
      update: { status: "paid" },
    })).rejects.toThrow(/declined/);
    expect(await bal("alice")).toBe(10_000);
  });
});
