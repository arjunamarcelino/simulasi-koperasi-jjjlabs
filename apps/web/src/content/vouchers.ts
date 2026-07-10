/**
 * Voucher catalog for the kasir redemption overlay. Simulated (mock codes, no
 * real integration). `cost` is in Point. Placeholder content — edit freely.
 */

export type Voucher = {
  id: string;
  name: string;
  cost: number;
  description?: string;
};

/** A redeemed voucher stored in the wallet. `name` is denormalized so the record
 * stays self-describing even if the catalog changes. */
export type RedeemedVoucher = {
  voucherId: string;
  name: string;
  code: string;
  redeemedAt: number;
};

export const VOUCHERS: readonly Voucher[] = [
  { id: "belanja-5k", name: "Voucher Belanja KDMP Rp5.000", cost: 50, description: "Potongan belanja di toko koperasi" },
  { id: "belanja-10k", name: "Voucher Belanja KDMP Rp10.000", cost: 100, description: "Potongan belanja di toko koperasi" },
  { id: "pulsa-5k", name: "Voucher Pulsa Rp5.000", cost: 60, description: "Isi ulang pulsa semua operator" },
  { id: "sembako", name: "Paket Sembako Hemat", cost: 150, description: "Beras 1kg + minyak + gula" },
  { id: "simpan-pinjam", name: "Diskon Biaya Simpan Pinjam", cost: 200, description: "Potongan administrasi pinjaman berikutnya" },
];

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
