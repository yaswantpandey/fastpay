"use client";

import { useState } from "react";
import { httpsCallable } from "firebase/functions";
import { v4 as uuid } from "uuid";
import { PiggyBank, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { KycBanner } from "@/components/kyc-banner";
import { functions } from "@/lib/firebase";
import { formatCents } from "@/lib/format";
import { usePots, useWallet } from "@/lib/hooks";
import { dollarsToCents } from "@/lib/schemas";
import type { Pot } from "@/types";

export default function SavingsPage() {
  const wallet = useWallet();
  const pots = usePots();
  const [name, setName] = useState("");
  const [target, setTarget] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const saved = pots.reduce((s, p) => s + p.balanceCents, 0);

  async function create(e: React.FormEvent) {
    e.preventDefault();
    const targetCents = target ? dollarsToCents(target) : 0;
    if (!name.trim()) return toast.error("Name your goal");
    if (targetCents === null) return toast.error("Enter a valid target, e.g. 500.00");
    setBusy("create");
    try {
      await httpsCallable(functions, "createPot")({ name: name.trim(), targetCents });
      setName(""); setTarget("");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <KycBanner />
      <div className="grid gap-4 sm:grid-cols-2">
        <Card><CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Available to spend</p>
          <p className="text-2xl font-semibold tabular-nums">{wallet ? formatCents(wallet.balanceCents) : "—"}</p>
        </CardContent></Card>
        <Card><CardContent className="pt-6">
          <p className="text-sm text-muted-foreground">Saved in goals</p>
          <p className="text-2xl font-semibold tabular-nums text-green-600">{formatCents(saved)}</p>
        </CardContent></Card>
      </div>

      <Card>
        <CardHeader>
          <CardTitle>New savings goal</CardTitle>
          <CardDescription>Money in a goal is set aside: it can&apos;t be sent until you move it back.</CardDescription>
        </CardHeader>
        <CardContent>
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-[2fr_1fr_auto] sm:items-end">
            <div className="space-y-1">
              <Label htmlFor="name">Name</Label>
              <Input id="name" maxLength={60} placeholder="Holiday fund" value={name} onChange={(e) => setName(e.target.value)} />
            </div>
            <div className="space-y-1">
              <Label htmlFor="target">Target (optional)</Label>
              <Input id="target" inputMode="decimal" placeholder="0.00" value={target} onChange={(e) => setTarget(e.target.value)} />
            </div>
            <Button type="submit" disabled={busy === "create"}>Create</Button>
          </form>
        </CardContent>
      </Card>

      {pots.length === 0 ? (
        <p className="py-6 text-center text-sm text-muted-foreground">No savings goals yet.</p>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {pots.map((p) => <PotCard key={p.id} pot={p} busy={busy === p.id} setBusy={setBusy} />)}
        </div>
      )}
    </div>
  );
}

function PotCard({ pot, busy, setBusy }: { pot: Pot; busy: boolean; setBusy: (id: string | null) => void }) {
  const [amount, setAmount] = useState("");
  const pct = pot.targetCents ? Math.min(100, (pot.balanceCents / pot.targetCents) * 100) : 0;

  async function move(direction: "in" | "out") {
    const amountCents = dollarsToCents(amount);
    if (!amountCents) return toast.error("Enter an amount, e.g. 25.00");
    setBusy(pot.id);
    try {
      await httpsCallable(functions, "movePotFunds")({ potId: pot.id, direction, amountCents, idempotencyKey: uuid() });
      toast.success(`${formatCents(amountCents)} ${direction === "in" ? "added to" : "moved out of"} ${pot.name}`);
      setAmount("");
    } catch (err) {
      toast.error((err as Error).message);
    } finally {
      setBusy(null);
    }
  }

  async function remove() {
    if (!confirm(`Delete "${pot.name}"?`)) return;
    try {
      await httpsCallable(functions, "deletePot")({ potId: pot.id });
    } catch (err) {
      toast.error((err as Error).message);
    }
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-2">
        <div>
          <CardTitle className="flex items-center gap-2"><PiggyBank className="size-4" /> {pot.name}</CardTitle>
          <CardDescription>
            {formatCents(pot.balanceCents)}{pot.targetCents ? ` of ${formatCents(pot.targetCents)}` : ""}
          </CardDescription>
        </div>
        <Button size="icon" variant="ghost" aria-label="Delete goal" disabled={pot.balanceCents > 0} onClick={remove}>
          <Trash2 className="size-4" />
        </Button>
      </CardHeader>
      <CardContent className="space-y-3">
        {pot.targetCents > 0 && (
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>Goal progress</span>
              <span className="font-medium text-foreground">{Math.round(pct)}%</span>
            </div>
            <div className="h-2 overflow-hidden rounded-full bg-muted">
              <div className="h-full bg-green-600 transition-all duration-300" style={{ width: `${pct}%` }} />
            </div>
          </div>
        )}
        <div className="flex gap-2">
          <Input inputMode="decimal" placeholder="0.00" aria-label="Amount" value={amount} onChange={(e) => setAmount(e.target.value)} />
          <Button size="sm" disabled={busy} onClick={() => move("in")}>Add</Button>
          <Button size="sm" variant="outline" disabled={busy || pot.balanceCents === 0} onClick={() => move("out")}>Withdraw</Button>
        </div>
      </CardContent>
    </Card>
  );
}
