export function formatCents(cents: number, currency = "USD", rate = 1): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency }).format(
    (cents * rate) / 100
  );
}

export const CURRENCIES = ["USD", "EUR", "GBP", "INR", "JPY", "CAD", "AUD"];
