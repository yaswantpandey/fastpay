"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth-provider";
import { functions } from "@/lib/firebase";

const IS_EMULATOR = process.env.NEXT_PUBLIC_USE_EMULATORS === "true";

/** Shown until the user is KYC-verified; money movement is blocked server-side until then. */
export function KycBanner() {
  const { profile } = useAuth();
  const [busy, setBusy] = useState(false);
  if (!profile || profile.kycStatus === "verified") return null;

  async function run(fn: () => Promise<void>) {
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  // Opens Stripe Identity's hosted flow (document + selfie). Result arrives by webhook.
  const start = () => run(async () => {
    const { data } = await httpsCallable<unknown, { url: string | null }>(functions, "startKyc")({});
    if (data.url) window.location.assign(data.url);
  });
  const devComplete = (outcome: "verified" | "rejected") => run(async () => {
    await httpsCallable(functions, "devCompleteKyc")({ outcome });
    toast.success(outcome === "verified" ? "Identity verified (dev)" : "Verification rejected (dev)");
  });

  const pending = profile.kycStatus === "pending";
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <span>
        {pending
          ? "Your identity verification is in progress."
          : profile.kycStatus === "rejected"
            ? `Verification didn't go through${profile.kycError ? ` (${profile.kycError})` : ""}. Please try again.`
            : "Verify your identity to add, send and receive money."}
      </span>
      <div className="flex gap-2">
        {!pending && <Button size="sm" onClick={start} disabled={busy}>{profile.kycStatus === "rejected" ? "Try again" : "Verify identity"}</Button>}
        {pending && !IS_EMULATOR && <Button size="sm" variant="outline" onClick={start} disabled={busy}>Continue verification</Button>}
        {IS_EMULATOR && pending && (
          <>
            <Button size="sm" variant="outline" onClick={() => devComplete("verified")} disabled={busy}>Approve (dev)</Button>
            <Button size="sm" variant="ghost" onClick={() => devComplete("rejected")} disabled={busy}>Reject (dev)</Button>
          </>
        )}
      </div>
    </div>
  );
}
