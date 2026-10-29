"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import {
  Send,
  PlusCircle,
  HandCoins,
  Split,
  PiggyBank,
  Coins,
  ShieldCheck,
  AlertCircle,
  ArrowUpRight,
  ArrowDownLeft,
  ChevronRight,
  UserPlus,
  Clock,
  Sparkles,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { BalanceCard } from "@/components/balance-card";
import { KycBanner } from "@/components/kyc-banner";
import { TransactionList } from "@/components/transaction-list";
import { useAuth } from "@/components/auth-provider";
import {
  useContacts,
  useInvoices,
  useLedger,
  usePaymentRequests,
  usePots,
  useWallet,
} from "@/lib/hooks";
import { formatCents } from "@/lib/format";

export default function DashboardPage() {
  const { user, profile } = useAuth();
  const wallet = useWallet();
  const recent = useLedger(6);
  const contacts = useContacts();
  const pots = usePots();
  const requests = usePaymentRequests();
  const { received: receivedInvoices } = useInvoices();

  // Greeting, Date & Monthly Stats (evaluated in client after mount to prevent prerender time instability)
  const [greeting, setGreeting] = useState("Welcome back");
  const [formattedDate, setFormattedDate] = useState("");
  const [monthlyInCents, setMonthlyInCents] = useState(0);
  const [monthlyOutCents, setMonthlyOutCents] = useState(0);

  useEffect(() => {
    const now = new Date();
    const hour = now.getHours();
    const g = hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
    const d = now.toLocaleDateString("en-US", {
      weekday: "long",
      month: "short",
      day: "numeric",
    });
    setGreeting(g);
    setFormattedDate(d);

    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    let inCents = 0;
    let outCents = 0;

    for (const e of recent) {
      if (!e.createdAt) continue;
      const date = e.createdAt.toDate();
      if (date.getMonth() === currentMonth && date.getFullYear() === currentYear) {
        if (e.amountCents > 0) inCents += e.amountCents;
        else outCents += Math.abs(e.amountCents);
      }
    }

    setMonthlyInCents(inCents);
    setMonthlyOutCents(outCents);
  }, [recent]);

  // Pending Actions
  const pendingRequestsToPay = useMemo(() => {
    if (!user) return [];
    return requests.filter((r) => r.payerUid === user.uid && r.status === "pending");
  }, [requests, user]);

  const unpaidInvoicesToPay = useMemo(() => {
    return receivedInvoices.filter((i) => i.status === "sent");
  }, [receivedInvoices]);

  const displayName = profile?.displayName || user?.displayName || user?.email?.split("@")[0] || "there";

  return (
    <div className="space-y-6">
      {/* Top Header / Greeting */}
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
              {greeting}, {displayName}
            </h1>
            {profile?.kycStatus === "verified" ? (
              <Badge variant="default" className="gap-1 bg-emerald-600 hover:bg-emerald-600/90 text-white">
                <ShieldCheck className="size-3" /> Verified
              </Badge>
            ) : (
              <Badge variant="outline" className="text-muted-foreground">
                Tier {profile?.tier ?? 0}
              </Badge>
            )}
          </div>
          <p className="text-xs text-muted-foreground">{formattedDate}</p>
        </div>

        <div className="flex items-center gap-2">
          <Link
            href="/send"
            className={buttonVariants({ size: "sm", className: "gap-1.5" })}
          >
            <Send className="size-3.5" /> Send
          </Link>
          <Link
            href="/add-money"
            className={buttonVariants({ size: "sm", variant: "outline", className: "gap-1.5" })}
          >
            <PlusCircle className="size-3.5" /> Add money
          </Link>
        </div>
      </div>

      <KycBanner />

      {/* Attention / Action Required Alerts */}
      {(pendingRequestsToPay.length > 0 || unpaidInvoicesToPay.length > 0) && (
        <div className="space-y-2">
          {pendingRequestsToPay.length > 0 && (
            <div className="flex items-center justify-between rounded-xl border border-amber-500/30 bg-amber-500/10 p-4 text-amber-900 dark:text-amber-200">
              <div className="flex items-center gap-3">
                <AlertCircle className="size-5 shrink-0 text-amber-600 dark:text-amber-400" />
                <div className="text-sm">
                  <span className="font-semibold">
                    {pendingRequestsToPay.length} payment request{pendingRequestsToPay.length > 1 ? "s" : ""}
                  </span>{" "}
                  waiting for your response.
                </div>
              </div>
              <Link
                href="/requests"
                className={buttonVariants({ size: "sm", variant: "outline", className: "border-amber-500/40" })}
              >
                Review
              </Link>
            </div>
          )}

          {unpaidInvoicesToPay.length > 0 && (
            <div className="flex items-center justify-between rounded-xl border border-blue-500/30 bg-blue-500/10 p-4 text-blue-900 dark:text-blue-200">
              <div className="flex items-center gap-3">
                <Clock className="size-5 shrink-0 text-blue-600 dark:text-blue-400" />
                <div className="text-sm">
                  <span className="font-semibold">
                    {unpaidInvoicesToPay.length} unpaid invoice{unpaidInvoicesToPay.length > 1 ? "s" : ""}
                  </span>{" "}
                  received.
                </div>
              </div>
              <Link
                href="/invoices"
                className={buttonVariants({ size: "sm", variant: "outline", className: "border-blue-500/40" })}
              >
                View
              </Link>
            </div>
          )}
        </div>
      )}

      {/* Main Grid: Balance & Quick Actions */}
      <div className="grid gap-6 md:grid-cols-[1.5fr_1fr]">
        <BalanceCard />

        {/* Quick Action Matrix */}
        <Card className="flex flex-col justify-between">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Quick Actions</CardTitle>
            <CardDescription>Instant payments and account tools</CardDescription>
          </CardHeader>
          <CardContent className="grid grid-cols-2 gap-2.5">
            <Link
              href="/send"
              className="flex items-center gap-2.5 rounded-lg border bg-card p-3 text-sm font-medium transition hover:bg-muted"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Send className="size-4" />
              </div>
              <span>Send</span>
            </Link>

            <Link
              href="/add-money"
              className="flex items-center gap-2.5 rounded-lg border bg-card p-3 text-sm font-medium transition hover:bg-muted"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <PlusCircle className="size-4" />
              </div>
              <span>Add funds</span>
            </Link>

            <Link
              href="/requests"
              className="flex items-center gap-2.5 rounded-lg border bg-card p-3 text-sm font-medium transition hover:bg-muted"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <HandCoins className="size-4" />
              </div>
              <span>Request</span>
            </Link>

            <Link
              href="/split"
              className="flex items-center gap-2.5 rounded-lg border bg-card p-3 text-sm font-medium transition hover:bg-muted"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Split className="size-4" />
              </div>
              <span>Split bill</span>
            </Link>

            <Link
              href="/savings"
              className="flex items-center gap-2.5 rounded-lg border bg-card p-3 text-sm font-medium transition hover:bg-muted"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <PiggyBank className="size-4" />
              </div>
              <span>Savings</span>
            </Link>

            <Link
              href="/currencies"
              className="flex items-center gap-2.5 rounded-lg border bg-card p-3 text-sm font-medium transition hover:bg-muted"
            >
              <div className="flex size-8 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                <Coins className="size-4" />
              </div>
              <span>Currencies</span>
            </Link>
          </CardContent>
        </Card>
      </div>

      {/* Monthly Cash Flow Stats */}
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-2">
        <Card>
          <CardContent className="flex items-center justify-between p-4 sm:p-5">
            <div>
              <p className="text-xs text-muted-foreground">Received this month</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-emerald-600 dark:text-emerald-400">
                +{formatCents(monthlyInCents)}
              </p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-full bg-emerald-500/10 text-emerald-600 dark:text-emerald-400">
              <ArrowDownLeft className="size-5" />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardContent className="flex items-center justify-between p-4 sm:p-5">
            <div>
              <p className="text-xs text-muted-foreground">Spent this month</p>
              <p className="mt-1 text-xl font-bold tabular-nums text-rose-600 dark:text-rose-400">
                −{formatCents(monthlyOutCents)}
              </p>
            </div>
            <div className="flex size-10 items-center justify-center rounded-full bg-rose-500/10 text-rose-600 dark:text-rose-400">
              <ArrowUpRight className="size-5" />
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Quick Send to Contacts */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <div>
            <CardTitle className="text-base">Quick Send</CardTitle>
            <CardDescription>Send money in one tap to saved contacts</CardDescription>
          </div>
          <Link href="/contacts" className="text-xs text-primary hover:underline">
            Manage contacts
          </Link>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-4 overflow-x-auto pb-2 scrollbar-none">
            <Link
              href="/contacts"
              className="flex flex-col items-center gap-1.5 text-center group shrink-0"
            >
              <div className="flex size-12 items-center justify-center rounded-full border border-dashed border-border group-hover:border-primary group-hover:bg-primary/5 transition">
                <UserPlus className="size-5 text-muted-foreground group-hover:text-primary transition" />
              </div>
              <span className="text-xs text-muted-foreground group-hover:text-foreground">Add new</span>
            </Link>

            {contacts.map((c) => {
              const initials = c.name
                ? c.name
                    .split(" ")
                    .map((n) => n[0])
                    .slice(0, 2)
                    .join("")
                    .toUpperCase()
                : c.email.slice(0, 2).toUpperCase();

              return (
                <Link
                  key={c.id}
                  href={`/send?to=${encodeURIComponent(c.email)}`}
                  className="flex flex-col items-center gap-1.5 text-center group shrink-0"
                >
                  <Avatar className="size-12 ring-2 ring-transparent group-hover:ring-primary transition">
                    <AvatarFallback className="bg-primary/10 text-primary font-semibold text-xs">
                      {initials}
                    </AvatarFallback>
                  </Avatar>
                  <span className="max-w-[70px] truncate text-xs font-medium group-hover:text-primary">
                    {c.name || c.email.split("@")[0]}
                  </span>
                </Link>
              );
            })}

            {contacts.length === 0 && (
              <p className="text-xs text-muted-foreground pl-2">
                No saved contacts yet. Add your friends and family for 1-tap transfers.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {/* Two Column Section: Savings Pots & Recent Transactions */}
      <div className="grid gap-6 md:grid-cols-[1fr_1.5fr]">
        {/* Savings Goals Preview */}
        <Card className="flex flex-col justify-between">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base">Savings Goals</CardTitle>
              <CardDescription>Pockets set aside</CardDescription>
            </div>
            <Link href="/savings" className="text-xs text-primary hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardContent className="space-y-4">
            {pots.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-6 text-center">
                <div className="mb-2 flex size-10 items-center justify-center rounded-full bg-primary/10 text-primary">
                  <PiggyBank className="size-5" />
                </div>
                <p className="text-xs text-muted-foreground">No active savings pots.</p>
                <Link
                  href="/savings"
                  className={buttonVariants({ variant: "outline", size: "sm", className: "mt-3 text-xs" })}
                >
                  Create a goal
                </Link>
              </div>
            ) : (
              pots.slice(0, 2).map((pot) => {
                const pct = pot.targetCents > 0 ? Math.min(100, Math.round((pot.balanceCents / pot.targetCents) * 100)) : 100;
                return (
                  <div key={pot.id} className="space-y-1.5 rounded-lg border p-3">
                    <div className="flex items-center justify-between text-xs font-medium">
                      <span>{pot.name}</span>
                      <span className="tabular-nums font-semibold">{pct}%</span>
                    </div>
                    <div className="h-2 w-full overflow-hidden rounded-full bg-muted">
                      <div
                        className="h-full bg-primary transition-all duration-500 rounded-full"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                    <div className="flex justify-between text-xs text-muted-foreground tabular-nums">
                      <span>{formatCents(pot.balanceCents)}</span>
                      <span>Target: {formatCents(pot.targetCents)}</span>
                    </div>
                  </div>
                );
              })
            )}
          </CardContent>
          <div className="border-t p-3">
            <Link
              href="/savings"
              className="flex items-center justify-between text-xs font-medium text-muted-foreground hover:text-foreground"
            >
              <span>Manage all goals</span>
              <ChevronRight className="size-3.5" />
            </Link>
          </div>
        </Card>

        {/* Recent Transactions Feed */}
        <Card>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base">Recent Activity</CardTitle>
              <CardDescription>Latest wallet movements</CardDescription>
            </div>
            <Link href="/history" className="text-xs text-primary hover:underline">
              View all
            </Link>
          </CardHeader>
          <CardContent>
            <TransactionList entries={recent} />
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
