import { getFirestore, Timestamp, WriteBatch } from "firebase-admin/firestore";
import { onSchedule } from "firebase-functions/v2/scheduler";
import { logger } from "firebase-functions";

/** Daily: expire stale payment requests and flag overdue invoices. */
export const dailyMaintenance = onSchedule("every day 00:15", async () => {
  const db = getFirestore();
  const now = Timestamp.now();

  const expired = await markAll(
    db.collection("paymentRequests").where("status", "==", "pending").where("expiresAt", "<", now),
    { status: "expired" }
  );
  const overdue = await markAll(
    db.collection("invoices").where("status", "==", "sent").where("dueDate", "<", now),
    { status: "overdue" }
  );
  logger.info("dailyMaintenance", { expired, overdue });
});

async function markAll(q: FirebaseFirestore.Query, update: Record<string, unknown>) {
  const db = getFirestore();
  let count = 0;
  for (;;) {
    const snap = await q.limit(400).get();
    if (snap.empty) return count;
    const batch: WriteBatch = db.batch();
    snap.docs.forEach((d) => batch.update(d.ref, update));
    await batch.commit();
    count += snap.size;
  }
}
