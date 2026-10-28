import Link from "next/link";
import { buttonVariants } from "@/components/ui/button";

export default function Home() {
  return (
    <div className="flex flex-col items-center gap-6 py-24 text-center">
      <h1 className="text-4xl font-bold tracking-tight">FastPay</h1>
      <p className="max-w-md text-lg text-muted-foreground">
        A global digital wallet. Hold USD, send money to anyone by email, and see every cent in your history.
      </p>
      <Link href="/login" className={buttonVariants({ size: "lg" })}>Get started</Link>
      <p className="text-xs text-muted-foreground">Test mode — no real money is moved.</p>
    </div>
  );
}
