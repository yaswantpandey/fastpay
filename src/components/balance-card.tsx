"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/format";
import { useDisplayRate, usePendingTopups, useWallet } from "@/lib/hooks";

export function BalanceCard() {
  const wallet = useWallet();
  const pending = usePendingTopups();
  const { currency, rate, fetchedAt } = useDisplayRate();
  const balance = wallet?.balanceCents ?? 0;
  const pendingCents = pending.reduce((s, t) => s + t.amountCents, 0);

  return (
    <Card>
      <CardHeader>
        <CardDescription>Available balance</CardDescription>
        <CardTitle className="text-4xl tabular-nums">{wallet ? formatCents(balance) : "—"}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-1 text-sm text-muted-foreground">
        {currency !== "USD" && (
          <p>
            ≈ {formatCents(balance, currency, rate)}{" "}
            <span className="text-xs">(indicative{fetchedAt ? `, rates from ${fetchedAt.toDate().toLocaleString()}` : ""})</span>
          </p>
        )}
        {pendingCents > 0 && <p>Pending top-ups: {formatCents(pendingCents)}</p>}
      </CardContent>
    </Card>
  );
}
