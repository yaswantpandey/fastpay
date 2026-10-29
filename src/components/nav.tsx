"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Wallet, Send, PlusCircle, History, Settings, LogOut, HandCoins, FileText, MoreHorizontal,
  Landmark, Users, Split, Repeat, BarChart3, Shield, Coins, PiggyBank, Store,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/components/auth-provider";
import { NotificationBell } from "@/components/notification-bell";
import { ThemeToggle } from "@/components/theme-toggle";
import { signOut } from "@/lib/auth";
import { useIsAdmin } from "@/lib/hooks";

const PRIMARY = [
  { href: "/dashboard", label: "Wallet", icon: Wallet },
  { href: "/send", label: "Send", icon: Send },
  { href: "/requests", label: "Requests", icon: HandCoins },
  { href: "/history", label: "History", icon: History },
];

const MORE = [
  { href: "/add-money", label: "Add money", icon: PlusCircle },
  { href: "/withdraw", label: "Withdraw", icon: Landmark },
  { href: "/currencies", label: "Currencies", icon: Coins },
  { href: "/savings", label: "Savings goals", icon: PiggyBank },
  { href: "/contacts", label: "Contacts & QR", icon: Users },
  { href: "/split", label: "Split a bill", icon: Split },
  { href: "/recurring", label: "Recurring", icon: Repeat },
  { href: "/invoices", label: "Invoices", icon: FileText },
  { href: "/merchant", label: "Merchant", icon: Store },
  { href: "/insights", label: "Insights", icon: BarChart3 },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function Nav() {
  const { user, mfaEnrolled } = useAuth();
  const isAdmin = useIsAdmin();
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => setOpen(false), [pathname]);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  if (!user || !mfaEnrolled) return null;
  const more = isAdmin ? [...MORE, { href: "/admin", label: "Admin", icon: Shield }] : MORE;
  const moreActive = more.some((l) => l.href === pathname);

  return (
    <header className="border-b bg-background">
      <div className="mx-auto flex max-w-5xl items-center gap-1 px-4 py-2">
        <Link href="/dashboard" className="mr-4 text-lg font-bold">FastPay</Link>
        {PRIMARY.map(({ href, label, icon: Icon }) => (
          <Link key={href} href={href}
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${
              pathname === href ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"
            }`}>
            <Icon className="size-4" />
            <span className="hidden sm:inline">{label}</span>
          </Link>
        ))}
        <div ref={ref} className="relative">
          <button onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="menu"
            className={`flex items-center gap-1.5 rounded-md px-3 py-1.5 text-sm ${
              moreActive ? "bg-muted font-medium" : "text-muted-foreground hover:text-foreground"
            }`}>
            <MoreHorizontal className="size-4" />
            <span className="hidden sm:inline">More</span>
          </button>
          {open && (
            <div role="menu" className="absolute left-0 z-50 mt-2 w-52 rounded-lg border bg-popover p-1 text-popover-foreground shadow-md">
              {more.map(({ href, label, icon: Icon }) => (
                <Link key={href} href={href} role="menuitem"
                  className={`flex items-center gap-2 rounded-md px-2 py-1.5 text-sm hover:bg-muted ${pathname === href ? "bg-muted font-medium" : ""}`}>
                  <Icon className="size-4" /> {label}
                </Link>
              ))}
            </div>
          )}
        </div>
        <NotificationBell />
        <ThemeToggle />
        <Button variant="ghost" size="sm" aria-label="Sign out" onClick={() => signOut()}>
          <LogOut className="size-4" />
        </Button>
      </div>
    </header>
  );
}
