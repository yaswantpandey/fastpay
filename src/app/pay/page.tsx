"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Pay-link / QR landing: /pay?to=<email>&amount=<dollars>&note=<text> → prefilled Send form. */
export default function PayLinkPage() {
  const router = useRouter();
  useEffect(() => {
    const p = new URLSearchParams(window.location.search);
    const next = new URLSearchParams();
    for (const k of ["to", "amount", "note"]) {
      const v = p.get(k);
      if (v) next.set(k, v.slice(0, 200));
    }
    router.replace(`/send?${next}`);
  }, [router]);
  return <p className="py-12 text-center text-sm text-muted-foreground">Opening payment…</p>;
}
