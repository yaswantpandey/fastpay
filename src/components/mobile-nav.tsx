"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Wallet, Send, HandCoins, History, Settings } from "lucide-react";
import { useAuth } from "@/components/auth-provider";

const NAV_ITEMS = [
  { href: "/dashboard", label: "Wallet", icon: Wallet },
  { href: "/send", label: "Send", icon: Send },
  { href: "/requests", label: "Requests", icon: HandCoins },
  { href: "/history", label: "History", icon: History },
  { href: "/settings", label: "Settings", icon: Settings },
];

export function MobileNav() {
  const { user, mfaEnrolled } = useAuth();
  const pathname = usePathname();

  if (!user || !mfaEnrolled) return null;

  return (
    <nav aria-label="Mobile Navigation" className="fixed bottom-0 left-0 right-0 z-40 border-t bg-background/95 backdrop-blur-md sm:hidden">
      <div className="flex h-16 items-center justify-around px-2">
        {NAV_ITEMS.map(({ href, label, icon: Icon }) => {
          const isActive = pathname === href;
          return (
            <Link
              key={href}
              href={href}
              className={`flex flex-col items-center justify-center gap-1 px-3 py-1 text-xs font-medium transition-colors ${
                isActive
                  ? "font-semibold text-primary"
                  : "text-muted-foreground hover:text-foreground"
              }`}
            >
              <Icon className="size-5" />
              <span>{label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
