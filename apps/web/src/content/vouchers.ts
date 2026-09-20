/**
 * Voucher catalog for the kasir redemption overlay. Simulated (mock codes, no real
 * integration). `cost` is in Point. The catalog data + `Voucher` type live in the
 * shared `@simkop/catalog` package (also seeds the DB); this module re-exports them
 * and keeps the wallet's `RedeemedVoucher` record type + its guards, which are
 * FE-only (not catalog content).
 */
export type { Voucher } from "@simkop/catalog";
export { VOUCHERS } from "@simkop/catalog";

/** A redeemed voucher stored in the wallet. `name` is denormalized so the record
 * stays self-describing even if the catalog changes. */
export type RedeemedVoucher = {
  voucherId: string;
  name: string;
  code: string;
  redeemedAt: number;
};

/** Type guard for a persisted RedeemedVoucher (validates element shape). */
export function isRedeemedVoucher(u: unknown): u is RedeemedVoucher {
  if (typeof u !== "object" || u === null) return false;
  const r = u as Record<string, unknown>;
  return (
    typeof r["voucherId"] === "string" &&
    typeof r["name"] === "string" &&
    typeof r["code"] === "string" &&
    typeof r["redeemedAt"] === "number"
  );
}

export function isRedeemedVoucherArray(u: unknown): u is RedeemedVoucher[] {
  return Array.isArray(u) && u.every(isRedeemedVoucher);
}
