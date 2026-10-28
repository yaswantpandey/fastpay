// End-to-end smoke test against the running emulators (npm run emulators).
//   node functions/scripts/smoke.mjs
process.env.FIRESTORE_EMULATOR_HOST ??= "127.0.0.1:8080";
process.env.FIREBASE_AUTH_EMULATOR_HOST ??= "127.0.0.1:9099";

import { initializeApp } from "firebase-admin/app";
import { getAuth } from "firebase-admin/auth";
import { getFirestore } from "firebase-admin/firestore";
import { randomUUID } from "crypto";

const PROJECT = "demo-fastpay";
const FN = `http://127.0.0.1:5001/${PROJECT}/us-central1`;
const FS = `http://127.0.0.1:8080/v1/projects/${PROJECT}/databases/(default)/documents`;
initializeApp({ projectId: PROJECT });
const db = getFirestore();

let pass = 0, fail = 0;
const check = (name, ok, extra = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${extra ? `  (${extra})` : ""}`);
};

async function user(email) {
  const password = "password123";
  try { await getAuth().createUser({ email, password, emailVerified: true }); } catch {}
  const r = await fetch(`http://127.0.0.1:9099/identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=fake`,
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ email, password, returnSecureToken: true }) });
  const { idToken, localId } = await r.json();
  return { email, uid: localId, token: idToken };
}

async function call(u, name, data) {
  const r = await fetch(`${FN}/${name}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${u.token}` },
    body: JSON.stringify({ data }),
  });
  const body = await r.json();
  if (body.error) { const e = new Error(body.error.message); e.status = body.error.status; throw e; }
  return body.result;
}
const callErr = (u, name, data) => call(u, name, data).then(() => null, (e) => e);

/** Client-side read through security rules. */
const clientGet = async (u, path) => (await fetch(`${FS}/${path}`, { headers: { authorization: `Bearer ${u.token}` } })).status;
const clientPatch = async (u, path, fields) => (await fetch(`${FS}/${path}?updateMask.fieldPaths=${Object.keys(fields).join("&updateMask.fieldPaths=")}`, {
  method: "PATCH", headers: { authorization: `Bearer ${u.token}`, "content-type": "application/json" },
  body: JSON.stringify({ fields }),
})).status;

const bal = async (u) => (await db.doc(`wallets/${u.uid}`).get()).data().balanceCents;

const run = Date.now();
const alice = await user(`alice${run}@test.dev`);
const bob = await user(`bob${run}@test.dev`);
const eve = await user(`eve${run}@test.dev`);

for (const u of [alice, bob, eve]) await call(u, "bootstrapUser", {});
check("bootstrapUser creates wallet", (await bal(alice)) === 0);

const e0 = await callErr(alice, "transfer", { toEmail: bob.email, amountCents: 100, note: "", idempotencyKey: randomUUID() });
check("unverified KYC cannot move money", e0?.status === "FAILED_PRECONDITION", e0?.message);

for (const u of [alice, bob]) await call(u, "devVerifyKyc", {});
// Simulate a completed top-up (Stripe not available locally).
await db.doc(`wallets/${alice.uid}`).update({ balanceCents: 50_000 });

// --- Transfers
const key = randomUUID();
await call(alice, "transfer", { toEmail: bob.email, amountCents: 1_234, note: "lunch", idempotencyKey: key });
await call(alice, "transfer", { toEmail: bob.email, amountCents: 1_234, note: "lunch", idempotencyKey: key });
check("transfer + replay moves money once", (await bal(alice)) === 48_766 && (await bal(bob)) === 1_234);
const e1 = await callErr(bob, "transfer", { toEmail: alice.email, amountCents: 99_999, note: "", idempotencyKey: randomUUID() });
check("insufficient funds rejected", /Insufficient/.test(e1?.message ?? ""), e1?.message);

// --- Payment requests
const { requestId } = await call(bob, "createRequest", { payerEmail: alice.email, amountCents: 500, note: "coffee" });
check("payer can read request", (await clientGet(alice, `paymentRequests/${requestId}`)) === 200);
check("outsider cannot read request", (await clientGet(eve, `paymentRequests/${requestId}`)) === 403);
const e2 = await callErr(bob, "respondRequest", { requestId, action: "pay" });
check("requester cannot pay own request", e2?.status === "NOT_FOUND", e2?.message);
const [p1, p2] = await Promise.all([
  call(alice, "respondRequest", { requestId, action: "pay" }).catch((e) => e),
  call(alice, "respondRequest", { requestId, action: "pay" }).catch((e) => e),
]);
check("double-pay request settles once", (await bal(alice)) === 48_266 && (await bal(bob)) === 1_734,
  `${p1?.status ?? p1?.message} / ${p2?.status ?? p2?.message}`);
const e3 = await callErr(alice, "respondRequest", { requestId, action: "decline" });
check("cannot decline a paid request", /paid/.test(e3?.message ?? ""), e3?.message);

const { requestId: r2 } = await call(bob, "createRequest", { payerEmail: alice.email, amountCents: 700, note: "" });
await call(alice, "respondRequest", { requestId: r2, action: "decline" });
check("decline moves no money", (await bal(alice)) === 48_266);

await db.doc(`paymentRequests/${r2}`).update({ status: "pending", expiresAt: new Date(Date.now() - 1000) });
const e4 = await callErr(alice, "respondRequest", { requestId: r2, action: "pay" });
check("expired request cannot be paid", /expired/.test(e4?.message ?? ""), e4?.message);

// --- Invoices
const due = new Date(Date.now() + 7 * 864e5).toISOString().slice(0, 10);
const { invoiceId } = await call(bob, "createInvoice", {
  recipientEmail: alice.email, dueDate: due, memo: "Thanks!", send: false,
  lineItems: [{ description: "Design", quantity: 3, unitPriceCents: 2_500 }, { description: "Hosting", quantity: 1, unitPriceCents: 999 }],
});
const inv = (await db.doc(`invoices/${invoiceId}`).get()).data();
check("invoice total computed server-side", inv.totalCents === 8_499 && inv.status === "draft");
const e5 = await callErr(alice, "invoiceAction", { invoiceId, action: "pay" });
check("draft invoice cannot be paid", /draft/.test(e5?.message ?? ""), e5?.message);
check("outsider cannot read invoice", (await clientGet(eve, `invoices/${invoiceId}`)) === 403);
check("recipient can read invoice", (await clientGet(alice, `invoices/${invoiceId}`)) === 200);
const e6 = await callErr(alice, "invoiceAction", { invoiceId, action: "send" });
check("recipient cannot send issuer's invoice", e6?.status === "PERMISSION_DENIED", e6?.message);
await call(bob, "invoiceAction", { invoiceId, action: "send" });
const pdf = await call(alice, "invoiceAction", { invoiceId, action: "pdf" });
check("PDF renders", Buffer.from(pdf.base64, "base64").subarray(0, 5).toString() === "%PDF-", pdf.filename);
await call(alice, "invoiceAction", { invoiceId, action: "pay" });
await call(alice, "invoiceAction", { invoiceId, action: "pay" }).catch(() => {});
check("invoice paid once", (await bal(alice)) === 39_767 && (await bal(bob)) === 10_233);
check("invoice marked paid", (await db.doc(`invoices/${invoiceId}`).get()).data().status === "paid");
const e7 = await callErr(bob, "invoiceAction", { invoiceId, action: "cancel" });
check("paid invoice cannot be cancelled", /paid/.test(e7?.message ?? ""), e7?.message);

// --- Ledger + notifications + rules
const ledger = (await db.collection("ledger").where("uid", "in", [alice.uid, bob.uid]).get()).docs.map((d) => d.data());
check("ledger nets to zero across users", ledger.reduce((s, e) => s + e.amountCents, 0) === 0, `${ledger.length} entries`);
const notes = await db.collection("notifications").where("uid", "==", alice.uid).get();
check("payer got request + invoice notifications", notes.size >= 3, `${notes.size}`);
const nId = notes.docs[0].id;
check("user can mark own notification read", (await clientPatch(alice, `notifications/${nId}`, { read: { booleanValue: true } })) === 200);
check("user cannot edit notification amount", (await clientPatch(alice, `notifications/${nId}`, { amountCents: { integerValue: "1" } })) === 403);
check("client cannot write wallet", (await clientPatch(alice, `wallets/${alice.uid}`, { balanceCents: { integerValue: "999999" } })) === 403);
check("client cannot read other wallet", (await clientGet(eve, `wallets/${alice.uid}`)) === 403);

// --- FX rates
const fx = await call(alice, "devRefreshFx", {});
const fxDoc = (await db.doc("fxRates/latest").get()).data();
check("FX rates fetched and stored", fxDoc?.base === "USD" && fxDoc.rates.EUR > 0 && fxDoc.rates.INR > 1,
  `EUR=${fx.rates.EUR} INR=${fx.rates.INR}`);
check("signed-in client can read FX rates", (await clientGet(eve, "fxRates/latest")) === 200);
check("client cannot write FX rates", (await clientPatch(eve, "fxRates/latest", { base: { stringValue: "EUR" } })) === 403);
check("other user cannot mark my notification read", (await clientPatch(eve, `notifications/${notes.docs[1].id}`, { read: { booleanValue: true } })) === 403);

// --- Withdrawals (dev payout mode on the emulator)
const w0 = await callErr(alice, "requestPayout", { amountCents: 1_000, idempotencyKey: randomUUID() });
check("withdrawal needs a linked bank", /Link a bank/.test(w0?.message ?? ""), w0?.message);
await call(alice, "createPayoutAccountLink", {});
const before = await bal(alice);
const pkey = randomUUID();
const { payoutId } = await call(alice, "requestPayout", { amountCents: 2_000, idempotencyKey: pkey });
await call(alice, "requestPayout", { amountCents: 2_000, idempotencyKey: pkey });
check("withdrawal holds funds once", (await bal(alice)) === before - 2_000);
check("user can read own payout", (await clientGet(alice, `payouts/${payoutId}`)) === 200);
check("other user cannot read payout", (await clientGet(eve, `payouts/${payoutId}`)) === 403);
const w1 = await callErr(bob, "devSettlePayout", { payoutId, outcome: "failed" });
check("other user cannot settle my payout", w1?.status === "NOT_FOUND", w1?.message);
await call(alice, "devSettlePayout", { payoutId, outcome: "failed" });
await call(alice, "devSettlePayout", { payoutId, outcome: "failed" });
check("failed withdrawal refunds exactly once", (await bal(alice)) === before);
const { payoutId: paidId } = await call(alice, "requestPayout", { amountCents: 1_500, idempotencyKey: randomUUID() });
await call(alice, "devSettlePayout", { payoutId: paidId, outcome: "paid" });
await call(alice, "devSettlePayout", { payoutId: paidId, outcome: "failed" });
check("paid withdrawal can't be refunded later", (await bal(alice)) === before - 1_500);

// --- Split bills
const carol = await user(`carol${run}@test.dev`);
await call(carol, "bootstrapUser", {});
await call(carol, "devVerifyKyc", {});
await db.doc(`wallets/${carol.uid}`).update({ balanceCents: 5_000 });
const s0 = await callErr(alice, "createSplit", { title: "Dinner", totalCents: 1_000,
  shares: [{ email: bob.email, amountCents: 600 }, { email: carol.email, amountCents: 600 }] });
check("split shares can't exceed total", /more than the total/.test(s0?.message ?? ""), s0?.message);
const s1 = await callErr(alice, "createSplit", { title: "Dinner", totalCents: 1_000, shares: [{ email: alice.email, amountCents: 300 }] });
check("split can't include yourself", /yourself/.test(s1?.message ?? ""), s1?.message);
const { splitId, requestIds } = await call(alice, "createSplit", { title: "Dinner", totalCents: 9_000,
  shares: [{ email: bob.email, amountCents: 3_000 }, { email: carol.email, amountCents: 3_000 }] });
check("split creates one request per person", requestIds.length === 2);
check("split owner can read split", (await clientGet(alice, `splits/${splitId}`)) === 200);
check("participant cannot read split doc", (await clientGet(bob, `splits/${splitId}`)) === 403);
const aliceBeforeSplit = await bal(alice);
await call(carol, "respondRequest", { requestId: requestIds[1], action: "pay" });
check("paying a split share credits requester", (await bal(alice)) === aliceBeforeSplit + 3_000);

// --- Recurring payments
const r0 = await callErr(alice, "createSchedule", { toEmail: bob.email, amountCents: 500, note: "", frequency: "weekly", startDate: "2020-01-01" });
check("schedule can't start in the past", /today or later/.test(r0?.message ?? ""), r0?.message);
const today = new Date().toISOString().slice(0, 10);
const { scheduleId } = await call(alice, "createSchedule", { toEmail: bob.email, amountCents: 700, note: "allowance", frequency: "weekly", startDate: today });
const aBefore = await bal(alice), bBefore = await bal(bob);
await Promise.all([call(alice, "devRunSchedules", {}), call(alice, "devRunSchedules", {})]);
await call(alice, "devRunSchedules", {});
check("due schedule pays exactly once", (await bal(alice)) === aBefore - 700 && (await bal(bob)) === bBefore + 700);
const sched = (await db.doc(`schedules/${scheduleId}`).get()).data();
check("schedule advanced to next week", sched.runCount === 1 && sched.nextRunAt.toMillis() > Date.now() + 6 * 864e5);
check("other user cannot read schedule", (await clientGet(bob, `schedules/${scheduleId}`)) === 403);
const r1 = await callErr(bob, "scheduleAction", { scheduleId, action: "cancel" });
check("other user cannot cancel schedule", r1?.status === "NOT_FOUND", r1?.message);
await call(alice, "scheduleAction", { scheduleId, action: "pause" });
await call(alice, "scheduleAction", { scheduleId, action: "resume" });
await call(alice, "scheduleAction", { scheduleId, action: "cancel" });
check("schedule pause/resume/cancel", (await db.doc(`schedules/${scheduleId}`).get()).data().status === "cancelled");

// --- Contacts + categories (client writes through rules)
const cPath = `users/${alice.uid}/contacts`;
const okContact = await fetch(`${FS}/${cPath}`, { method: "POST", headers: { authorization: `Bearer ${alice.token}`, "content-type": "application/json" },
  body: JSON.stringify({ fields: { email: { stringValue: bob.email }, name: { stringValue: "Bob" } } }) });
check("user can save a contact", okContact.status === 200);
const badContact = await fetch(`${FS}/${cPath}`, { method: "POST", headers: { authorization: `Bearer ${alice.token}`, "content-type": "application/json" },
  body: JSON.stringify({ fields: { email: { stringValue: bob.email }, name: { stringValue: "Bob" }, balanceCents: { integerValue: "1" } } }) });
check("contact rejects extra fields", badContact.status === 403);
const otherContact = await fetch(`${FS}/${cPath}`, { method: "POST", headers: { authorization: `Bearer ${eve.token}`, "content-type": "application/json" },
  body: JSON.stringify({ fields: { email: { stringValue: eve.email }, name: { stringValue: "" } } }) });
check("user cannot write someone else's contacts", otherContact.status === 403);
const outEntry = (await db.collection("ledger").where("uid", "==", alice.uid).where("type", "==", "transfer_out").limit(1).get()).docs[0];
check("user can tag own ledger entry", (await clientPatch(alice, `ledger/${outEntry.id}`, { category: { stringValue: "food" } })) === 200);
check("ledger rejects unknown category", (await clientPatch(alice, `ledger/${outEntry.id}`, { category: { stringValue: "hacks" } })) === 403);
check("ledger amount stays read-only", (await clientPatch(alice, `ledger/${outEntry.id}`, { amountCents: { integerValue: "0" } })) === 403);
check("cannot tag someone else's entry", (await clientPatch(eve, `ledger/${outEntry.id}`, { category: { stringValue: "food" } })) === 403);

// --- Insights stats
const m = new Date().toISOString().slice(0, 7);
const st = (await db.doc(`stats/${alice.uid}_${m}`).get()).data();
check("monthly stats recorded", st?.outCents > 0 && st?.inCents > 0, `in=${st?.inCents} out=${st?.outCents}`);
check("user can read own stats", (await clientGet(alice, `stats/${alice.uid}_${m}`)) === 200);
check("other user cannot read stats", (await clientGet(eve, `stats/${alice.uid}_${m}`)) === 403);

// --- Admin console
const a0 = await callErr(alice, "adminSearchUsers", {});
check("non-admin blocked from admin API", a0?.status === "PERMISSION_DENIED", a0?.message);
await getAuth().setCustomUserClaims(eve.uid, { admin: true });
const admin = await user(eve.email); // re-sign-in to pick up the claim
const found = await call(admin, "adminSearchUsers", { email: `bob${run}` });
check("admin can search users", found.users.length === 1 && found.users[0].uid === bob.uid);
const bobTransfers = (await call(admin, "adminUserTransfers", { uid: bob.uid })).transfers;
const lunch = bobTransfers.find((t) => t.note === "lunch");
const aRev = await bal(alice), bRev = await bal(bob);
await call(admin, "adminReverseTransfer", { txId: lunch.txId, reason: "fraud report" });
const again = await callErr(admin, "adminReverseTransfer", { txId: lunch.txId, reason: "again" });
check("admin reversal moves funds back once", (await bal(alice)) === aRev + 1_234 && (await bal(bob)) === bRev - 1_234,
  again?.message);
await call(admin, "adminUserAction", { uid: bob.uid, action: "freeze", reason: "investigation" });
const bobFresh = await user(bob.email); // freeze revokes refresh tokens; sign in again
const f0 = await callErr(bobFresh, "transfer", { toEmail: alice.email, amountCents: 100, note: "", idempotencyKey: randomUUID() });
check("frozen user cannot move money", /frozen/.test(f0?.message ?? ""), f0?.message);
await call(admin, "adminUserAction", { uid: bob.uid, action: "unfreeze", reason: "cleared" });
await call(bobFresh, "transfer", { toEmail: alice.email, amountCents: 100, note: "", idempotencyKey: randomUUID() });
check("unfrozen user can move money again", true);
const log = (await call(admin, "adminAuditLog", { uid: admin.uid })).entries.map((e) => e.action);
check("admin actions are audited", ["admin.reverse", "admin.freeze", "admin.unfreeze"].every((a) => log.includes(a)), log.slice(0, 4).join(","));
check("admin still cannot read audit logs directly", (await clientGet(admin, `auditLogs/${(await db.collection("auditLogs").limit(1).get()).docs[0].id}`)) === 403);

// --- KYC (Stripe Identity, simulated on the emulator)
const kim = await user(`kim${run}@test.dev`);
await call(kim, "bootstrapUser", {});
const k0 = await callErr(kim, "devCompleteKyc", { outcome: "verified" });
check("KYC result needs a started session", /Start verification/.test(k0?.message ?? ""), k0?.message);
const ks = await call(kim, "startKyc", {});
check("startKyc marks pending", ks.status === "pending" && (await db.doc(`users/${kim.uid}`).get()).data().kycStatus === "pending");
await call(kim, "devCompleteKyc", { outcome: "rejected" });
let kimDoc = (await db.doc(`users/${kim.uid}`).get()).data();
check("rejected KYC records reason, no tier", kimDoc.kycStatus === "rejected" && kimDoc.tier === 0 && !!kimDoc.kycError);
await call(kim, "startKyc", {});
await call(kim, "devCompleteKyc", { outcome: "verified" });
kimDoc = (await db.doc(`users/${kim.uid}`).get()).data();
check("verified KYC sets tier 1", kimDoc.kycStatus === "verified" && kimDoc.tier === 1);
const t0 = await callErr(alice, "adminSetTier", { uid: kim.uid, tier: 2, reason: "x" });
check("non-admin cannot set tier", t0?.status === "PERMISSION_DENIED");
await call(admin, "adminSetTier", { uid: kim.uid, tier: 2, reason: "enhanced due diligence" });
check("admin can raise tier", (await db.doc(`users/${kim.uid}`).get()).data().tier === 2);
check("user cannot raise own tier via client write",
  (await clientPatch(kim, `users/${kim.uid}`, { tier: { integerValue: "9" } })) === 403);

// --- Email notifications
await new Promise((r) => setTimeout(r, 4000)); // triggers run asynchronously
const kimMail = await db.collection("mailOutbox").where("to", "==", kim.email).get();
check("KYC notification was emailed (dev outbox)", kimMail.size >= 2 && kimMail.docs.every((d) => ["logged", "queued"].includes(d.data().status)),
  `${kimMail.size} mails`);
check("user can opt out of email", (await clientPatch(kim, `users/${kim.uid}`, { emailNotifications: { booleanValue: false } })) === 200);
check("opt-out must be boolean", (await clientPatch(kim, `users/${kim.uid}`, { emailNotifications: { stringValue: "no" } })) === 403);
const strangerInvoice = await call(bob, "createInvoice", {
  recipientEmail: `stranger${run}@nowhere.dev`, dueDate: due, memo: "", send: true,
  lineItems: [{ description: "Consulting", quantity: 1, unitPriceCents: 5_000 }],
});
const invMail = (await db.doc(`mailOutbox/invoice_${strangerInvoice.invoiceId}`).get()).data();
check("invoice to non-user is emailed", invMail?.to === `stranger${run}@nowhere.dev`);
check("client cannot read mail outbox", (await clientGet(bob, `mailOutbox/invoice_${strangerInvoice.invoiceId}`)) === 403);

// --- Multi-currency
await call(alice, "devRefreshFx", {});
const rates = (await db.doc("fxRates/latest").get()).data().rates;
const eurRate = rates.EUR * 0.995;
const usdBeforeFx = await bal(alice);
const fxKey = randomUUID();
const c1 = await call(alice, "convert", { from: "USD", to: "EUR", amountMinor: 10_000, idempotencyKey: fxKey, quotedRate: eurRate });
await call(alice, "convert", { from: "USD", to: "EUR", amountMinor: 10_000, idempotencyKey: fxKey, quotedRate: eurRate });
const eurBal = () => db.doc(`balances/${alice.uid}_EUR`).get().then((s) => s.data()?.balanceMinor ?? 0);
check("convert debits USD once and credits EUR", (await bal(alice)) === usdBeforeFx - 10_000 && (await eurBal()) === c1.toMinor,
  `$100 → €${(c1.toMinor / 100).toFixed(2)}`);
check("conversion applies spread and rounds down", c1.toMinor === Math.floor(100 * rates.EUR * 0.995 * 100 + 1e-9));
const fxBad = await callErr(alice, "convert", { from: "USD", to: "EUR", amountMinor: 1_000, idempotencyKey: randomUUID(), quotedRate: eurRate * 1.05 });
check("rate-moved guard refuses stale quotes", fxBad?.status === "ABORTED", fxBad?.message);
const fxOver = await callErr(alice, "convert", { from: "EUR", to: "USD", amountMinor: c1.toMinor + 1, idempotencyKey: randomUUID(), quotedRate: (1 / rates.EUR) * 0.995 });
check("cannot convert more than the balance", /Insufficient/.test(fxOver?.message ?? ""), fxOver?.message);
const back = await call(alice, "convert", { from: "EUR", to: "USD", amountMinor: c1.toMinor, idempotencyKey: randomUUID(), quotedRate: (1 / rates.EUR) * 0.995 });
check("round trip never creates money", back.toMinor <= 10_000 && back.toMinor > 9_800, `$100 → $${(back.toMinor / 100).toFixed(2)}`);
const eurLedger = (await db.collection("currencyLedger").where("uid", "==", alice.uid).where("currency", "==", "EUR").get()).docs;
check("EUR balance equals EUR ledger", eurLedger.reduce((s, d) => s + d.data().amountMinor, 0) === (await eurBal()));
check("other user cannot read my balances", (await clientGet(eve, `balances/${alice.uid}_EUR`)) === 403);
await db.doc("fxRates/latest").update({ fetchedAt: new Date(Date.now() - 2 * 864e5) });
const fxStale = await callErr(alice, "convert", { from: "USD", to: "EUR", amountMinor: 100, idempotencyKey: randomUUID(), quotedRate: eurRate });
check("out-of-date rates are refused", /out of date/.test(fxStale?.message ?? ""), fxStale?.message);
await call(alice, "devRefreshFx", {});

// --- Savings goals
const { potId } = await call(alice, "createPot", { name: "Holiday", targetCents: 50_000 });
const preSave = await bal(alice);
const saveKey = randomUUID();
await call(alice, "movePotFunds", { potId, direction: "in", amountCents: 3_000, idempotencyKey: saveKey });
await call(alice, "movePotFunds", { potId, direction: "in", amountCents: 3_000, idempotencyKey: saveKey });
check("saving moves money once", (await bal(alice)) === preSave - 3_000 && (await db.doc(`pots/${potId}`).get()).data().balanceCents === 3_000);
const sv0 = await callErr(alice, "deletePot", { potId });
check("can't delete a goal with money in it", /Move the money out/.test(sv0?.message ?? ""), sv0?.message);
const sv1 = await callErr(eve, "movePotFunds", { potId, direction: "out", amountCents: 100, idempotencyKey: randomUUID() });
check("other user can't touch my goal", sv1?.status === "NOT_FOUND", sv1?.message);
check("other user can't read my goal", (await clientGet(eve, `pots/${potId}`)) === 403);
await call(alice, "movePotFunds", { potId, direction: "out", amountCents: 3_000, idempotencyKey: randomUUID() });
await call(alice, "deletePot", { potId });
check("withdraw then delete goal", (await bal(alice)) === preSave && !(await db.doc(`pots/${potId}`).get()).exists);

// --- Merchant checkout
import { createServer } from "http";
import { createHmac } from "crypto";
const received = [];
let failNext = 1; // first delivery fails to exercise retries
const hookServer = createServer((req, res) => {
  let body = "";
  req.on("data", (c) => (body += c));
  req.on("end", () => {
    received.push({ sig: req.headers["fastpay-signature"], body });
    if (failNext-- > 0) { res.writeHead(500); res.end("nope"); return; }
    res.writeHead(200); res.end("ok");
  });
});
await new Promise((r) => hookServer.listen(0, "127.0.0.1", r));
const hookUrl = `http://127.0.0.1:${hookServer.address().port}/hook`;

const m0 = await callErr(carol, "setMerchantProfile", { businessName: "Carol's Cafe", webhookUrl: "http://10.0.0.5/hook" });
check("webhook URL to internal host is refused", m0?.status === "INVALID_ARGUMENT", m0?.message);
await call(carol, "setMerchantProfile", { businessName: "Carol's Cafe", webhookUrl: hookUrl });
const secret = (await db.doc(`merchants/${carol.uid}`).get()).data().webhookSecret;
check("merchant can read own profile + secret", (await clientGet(carol, `merchants/${carol.uid}`)) === 200);
check("others cannot read merchant secret", (await clientGet(alice, `merchants/${carol.uid}`)) === 403);
const { key: apiKey, keyId } = await call(carol, "createApiKey", {});
check("API key is never stored in plaintext", !JSON.stringify((await db.doc(`apiKeys/${keyId}`).get()).data()).includes(apiKey));
const API = `${FN}/api`;
const apiCall = (path, { method = "GET", key = apiKey, body, headers = {} } = {}) => fetch(`${API}${path}`, {
  method, headers: { authorization: `Bearer ${key}`, "content-type": "application/json", ...headers },
  body: body ? JSON.stringify(body) : undefined,
});
check("API rejects a bad key", (await apiCall("/v1/checkouts", { method: "POST", key: "fp_test_notarealkeynotarealkey", body: {} })).status === 401);
check("API validates the body", (await apiCall("/v1/checkouts", { method: "POST", body: { amountCents: -5 } })).status === 400);
const idem = { "idempotency-key": `order-${run}` };
const co1 = await (await apiCall("/v1/checkouts", { method: "POST", body: { amountCents: 1_999, description: "Latte x2", reference: "order-42" }, headers: idem })).json();
const co2 = await (await apiCall("/v1/checkouts", { method: "POST", body: { amountCents: 1_999, description: "Latte x2", reference: "order-42" }, headers: idem })).json();
check("API creates checkout; Idempotency-Key dedupes", co1.id && co1.id === co2.id && co1.status === "open" && co1.url.includes(co1.id));
const otherKey = (await call(alice, "setMerchantProfile", { businessName: "Alice Co", webhookUrl: "" }), await call(alice, "createApiKey", {})).key;
check("merchants can't read each other's checkouts", (await apiCall(`/v1/checkouts/${co1.id}`, { key: otherKey })).status === 404);
const view = await call(alice, "getCheckout", { checkoutId: co1.id });
check("hosted page sees public checkout details", view.businessName === "Carol's Cafe" && view.amountCents === 1_999 && !("merchantUid" in view));
const p0 = await callErr(carol, "payCheckout", { checkoutId: co1.id });
check("merchant can't pay own checkout", p0?.status === "INVALID_ARGUMENT");
const aPay = await bal(alice), cPay = await bal(carol);
await call(alice, "payCheckout", { checkoutId: co1.id });
await call(alice, "payCheckout", { checkoutId: co1.id });
const payErr = await callErr(bob, "payCheckout", { checkoutId: co1.id });
check("checkout paid exactly once", (await bal(alice)) === aPay - 1_999 && (await bal(carol)) === cPay + 1_999 && /paid/.test(payErr?.message ?? ""),
  payErr?.message);
const got = await (await apiCall(`/v1/checkouts/${co1.id}`)).json();
check("API reports checkout paid", got.status === "paid" && got.paid_at > 0);
// The delivery trigger runs asynchronously (and cold-starts on the emulator); wait for the first attempt.
let delivery;
for (let i = 0; i < 40; i++) {
  delivery = (await db.doc(`webhookDeliveries/${co1.id}_paid`).get()).data();
  if (delivery?.attempts >= 1) break;
  await new Promise((r) => setTimeout(r, 500));
}
check("failed webhook is scheduled for retry", delivery?.status === "pending" && delivery.attempts === 1 && delivery.lastStatus === 500,
  `${delivery?.status} attempts=${delivery?.attempts}`);
await call(carol, "devRetryWebhooks", {});
delivery = (await db.doc(`webhookDeliveries/${co1.id}_paid`).get()).data();
check("webhook delivered on retry", delivery.status === "delivered" && delivery.attempts === 2);
const last = received.at(-1);
const [, ts, v1] = last.sig.match(/^t=(\d+),v1=([0-9a-f]+)$/) ?? [];
check("webhook signature verifies with merchant secret",
  v1 === createHmac("sha256", secret).update(`${ts}.${last.body}`).digest("hex") && JSON.parse(last.body).type === "checkout.paid");
await call(carol, "revokeApiKey", { keyId });
check("revoked key stops working", (await apiCall(`/v1/checkouts/${co1.id}`)).status === 401);
hookServer.close();

// --- Fraud rules
const dave = await user(`dave${run}@test.dev`);
await call(dave, "bootstrapUser", {});
await call(dave, "devVerifyKyc", {});
await db.doc(`wallets/${dave.uid}`).update({ balanceCents: 100_000 });
const dPre = await bal(dave), aPreHold = await bal(alice);
const held = await call(dave, "transfer", { toEmail: alice.email, amountCents: 30_000, note: "big", idempotencyKey: randomUUID() });
check("large payment from new account is held", held.status === "held" && (await bal(dave)) === dPre - 30_000 && (await bal(alice)) === aPreHold);
check("sender can see own hold", (await clientGet(dave, `holds/${held.txId}`)) === 200);
check("recipient can't see the hold", (await clientGet(alice, `holds/${held.txId}`)) === 403);
const queue = (await call(admin, "adminListHolds", {})).holds;
check("hold appears in admin review queue", queue.some((h) => h.holdId === held.txId));
await call(admin, "adminDecideHold", { holdId: held.txId, decision: "approve", reason: "verified by phone" });
check("approved hold pays the recipient once", (await bal(alice)) === aPreHold + 30_000 && (await bal(dave)) === dPre - 30_000);
const held2 = await call(dave, "transfer", { toEmail: bob.email, amountCents: 25_000, note: "", idempotencyKey: randomUUID() });
check("second large payment is also held", held2.status === "held");
await call(admin, "adminDecideHold", { holdId: held2.txId, decision: "reject", reason: "suspicious" });
check("rejected hold refunds the sender", (await bal(dave)) === dPre - 30_000);
const hd = await callErr(admin, "adminDecideHold", { holdId: held2.txId, decision: "approve", reason: "changed mind" });
check("decided hold can't be re-decided", /rejected/.test(hd?.message ?? ""), hd?.message);
for (let i = 0; i < 2; i++) await call(dave, "transfer", { toEmail: alice.email, amountCents: 100, note: "", idempotencyKey: randomUUID() });
const vel = await callErr(dave, "transfer", { toEmail: alice.email, amountCents: 100, note: "", idempotencyKey: randomUUID() });
check("velocity rule blocks rapid payments", /blocked/.test(vel?.message ?? ""), vel?.message);
await call(admin, "adminUserAction", { uid: bob.uid, action: "freeze", reason: "test" });
// kim has no payment history, so only the frozen-recipient rule can fire.
const fz = await callErr(kim, "transfer", { toEmail: bob.email, amountCents: 100, note: "", idempotencyKey: randomUUID() });
check("payments to frozen accounts are blocked", /unavailable/.test(fz?.message ?? ""), fz?.message);
await call(admin, "adminUserAction", { uid: bob.uid, action: "unfreeze", reason: "test done" });

// --- Global invariant: every cent is accounted for
const allLedger = (await db.collection("ledger").where("uid", "in", [alice.uid, bob.uid, carol.uid, dave.uid]).get()).docs.map((d) => d.data());
const walletsTotal = (await bal(alice)) + (await bal(bob)) + (await bal(carol)) + (await bal(dave));
const seeded = 50_000 + 5_000 + 100_000; // direct test seeds (no top-up ledger entries)
check("wallets = seeds + ledger across users", walletsTotal === seeded + allLedger.reduce((s, e) => s + e.amountCents, 0),
  `wallets=${walletsTotal}`);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
