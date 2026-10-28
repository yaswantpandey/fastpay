"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell } from "lucide-react";
import { doc, updateDoc } from "firebase/firestore";
import { Button } from "@/components/ui/button";
import { db } from "@/lib/firebase";
import { formatCents } from "@/lib/format";
import { useNotifications } from "@/lib/hooks";
import type { AppNotification } from "@/types";

const TEXT: Record<AppNotification["kind"], { verb: string; href: string }> = {
  transfer_in: { verb: "sent you", href: "/history" },
  request: { verb: "requested", href: "/requests" },
  invoice: { verb: "invoiced you", href: "/invoices" },
  schedule_failed: { verb: "— recurring payment failed:", href: "/recurring" },
  kyc: { verb: "·", href: "/settings" },
  hold: { verb: "· payment to them", href: "/history" },
};

export function NotificationBell() {
  const items = useNotifications(20);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const unread = items.filter((n) => !n.read);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => { if (!ref.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, [open]);

  // Rules only allow flipping `read` to true on your own notifications.
  const markRead = (ids: string[]) =>
    Promise.all(ids.map((id) => updateDoc(doc(db, "notifications", id), { read: true }))).catch(() => {});

  return (
    <div ref={ref} className="relative ml-auto">
      <Button variant="ghost" size="sm" aria-label={`Notifications (${unread.length} unread)`} onClick={() => setOpen((o) => !o)}>
        <Bell className="size-4" />
        {unread.length > 0 && (
          <span className="absolute -top-0.5 -right-0.5 flex size-4 items-center justify-center rounded-full bg-red-600 text-[10px] text-white">
            {unread.length > 9 ? "9+" : unread.length}
          </span>
        )}
      </Button>
      {open && (
        <div className="fixed top-12 right-4 z-50 w-80 max-w-[calc(100vw-2rem)] rounded-lg border bg-popover p-2 text-popover-foreground shadow-md">
          <div className="flex items-center justify-between px-2 pb-2">
            <span className="text-sm font-medium">Notifications</span>
            {unread.length > 0 && (
              <button className="text-xs text-muted-foreground hover:underline" onClick={() => markRead(unread.map((n) => n.id))}>
                Mark all read
              </button>
            )}
          </div>
          {items.length === 0 ? (
            <p className="px-2 py-6 text-center text-sm text-muted-foreground">You&apos;re all caught up.</p>
          ) : (
            <ul className="max-h-96 overflow-y-auto">
              {items.map((n) => (
                <li key={n.id}>
                  <Link href={TEXT[n.kind].href}
                    onClick={() => { if (!n.read) markRead([n.id]); setOpen(false); }}
                    className={`block rounded-md px-2 py-2 text-sm hover:bg-muted ${n.read ? "text-muted-foreground" : ""}`}>
                    <span className={n.read ? "" : "font-medium"}>{n.fromEmail}</span> {TEXT[n.kind].verb}{" "}
                    <span className="tabular-nums">{n.amountCents ? formatCents(n.amountCents) : ""}</span>
                    {n.note ? ` — ${n.note}` : ""}
                    <span className="block text-xs text-muted-foreground">{n.createdAt?.toDate().toLocaleString() ?? "…"}</span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
