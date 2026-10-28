"use client";

import Link from "next/link";
import { Send, PlusCircle } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { BalanceCard } from "@/components/balance-card";
import { KycBanner } from "@/components/kyc-banner";
import { TransactionList } from "@/components/transaction-list";
import { useAuth } from "@/components/auth-provider";
import { useLedger } from "@/lib/hooks";

export default function DashboardPage() {
  const { profile } = useAuth();
  const recent = useLedger(5);

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-semibold">Hi{profile?.displayName ? `, ${profile.displayName.split(" ")[0]}` : ""}</h1>
      <KycBanner />
      <div className="grid gap-6 md:grid-cols-[2fr_1fr]">
        <BalanceCard />
        <div className="flex flex-col gap-3">
          <Link href="/send" className={buttonVariants({ size: "lg", className: "h-12" })}>
            <Send /> Send money
          </Link>
          <Link href="/add-money" className={buttonVariants({ size: "lg", variant: "outline", className: "h-12" })}>
            <PlusCircle /> Add money
          </Link>
        </div>
      </div>
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle>Recent activity</CardTitle>
          <Link href="/history" className="text-sm text-muted-foreground hover:underline">View all</Link>
        </CardHeader>
        <CardContent>
          <TransactionList entries={recent} />
        </CardContent>
      </Card>
    </div>
  );
}
