"use client";

import { useState } from "react";
import type { MultiFactorResolver } from "firebase/auth";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { signInWithGoogle, resolveTotpSignIn } from "@/lib/auth";

export default function LoginPage() {
  const [busy, setBusy] = useState(false);
  const [resolver, setResolver] = useState<MultiFactorResolver | null>(null);
  const [code, setCode] = useState("");

  async function google() {
    setBusy(true);
    try {
      const r = await signInWithGoogle();
      if (r.status === "mfa_required") setResolver(r.resolver);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault();
    if (!resolver) return;
    setBusy(true);
    try {
      await resolveTotpSignIn(resolver, code);
    } catch {
      toast.error("Invalid code. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="mx-auto mt-12 max-w-sm">
      <CardHeader>
        <CardTitle>{resolver ? "Two-factor authentication" : "Sign in to FastPay"}</CardTitle>
        <CardDescription>
          {resolver ? "Enter the 6-digit code from your authenticator app." : "Use your Google account to sign in or sign up."}
        </CardDescription>
      </CardHeader>
      <CardContent>
        {resolver ? (
          <form onSubmit={verify} className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="code">Code</Label>
              <Input id="code" inputMode="numeric" autoComplete="one-time-code" maxLength={6}
                value={code} onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} autoFocus />
            </div>
            <Button type="submit" className="w-full" disabled={busy || code.length !== 6}>Verify</Button>
          </form>
        ) : (
          <Button className="w-full" onClick={google} disabled={busy}>Continue with Google</Button>
        )}
      </CardContent>
    </Card>
  );
}
