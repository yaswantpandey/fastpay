"use client";

import { useState } from "react";
import { Eye, EyeOff } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { formatCents } from "@/lib/format";
import { useDisplayRate, usePendingTopups, useWallet } from "@/lib/hooks";

export function BalanceCard() {
  const [masked, setMasked] = useState(false);
  const wallet = useWallet();
  const pending = usePendingTopups();
  const { currency, rate, fetchedAt } = useDisplayRate();
  const balance = wallet?.balanceCents ?? 0;
  const pendingCents = pending.reduce((s, t) => s + t.amountCents, 0);

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardDescription>Available balance</CardDescription>
        <Button
          variant="ghost"
          size="sm"
          className="size-8 p-0 text-muted-foreground hover:text-foreground"
          aria-label={masked ? "Show balance" : "Hide balance"}
          onClick={() => setMasked(!masked)}
        >
          {masked ? <Eye className="size-4" /> : <EyeOff className="size-4" />}
        </Button>
      </CardHeader>
      <CardContent>
        <CardTitle className="text-4xl tabular-nums">
          {masked ? "$••••••" : wallet ? formatCents(balance) : "—"}
        </CardTitle>
        <div className="mt-2 space-y-1 text-sm text-muted-foreground">
          {currency !== "USD" && !masked && (
            <p>
              ≈ {formatCents(balance, currency, rate)}{" "}
              <span className="text-xs">(indicative{fetchedAt ? `, rates from ${fetchedAt.toDate().toLocaleString()}` : ""})</span>
            </p>
          )}
          {pendingCents > 0 && (
            <p>Pending top-ups: {masked ? "$•••" : formatCents(pendingCents)}</p>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
