import { useState } from "react";
import { useGameStore, gameStore } from "../../stores/game.store";
import { VOUCHERS } from "../../content/vouchers";
import { ModalShell } from "../common/ModalShell";
import { GameButton } from "../common/GameButton";

/**
 * Kasir voucher redemption. Mounted only while activeOverlay === "KASIR_VOUCHER"
 * (see HubPage). Point balance + redeemed list come from the store (reactive);
 * the redeem gate is enforced in the store (redeemVoucher re-reads live point).
 */
export function KasirVoucherBoard() {
  const point = useGameStore((s) => s.point);
  const redeemed = useGameStore((s) => s.redeemedVouchers);
  const [lastCode, setLastCode] = useState<string | null>(null);

  const close = () => gameStore.getState().clearSelection();
  const onRedeem = (id: string) => {
    const result = gameStore.getState().redeemVoucher(id);
    if (result) setLastCode(result.code);
  };

  return (
    <ModalShell titleId="kasir-title" onClose={close} panelClassName="w-full max-w-md">
      <h2 id="kasir-title" className="mb-4 text-center font-display text-sm text-forest md:text-base">
        Kasir Koperasi
      </h2>

      <div className="mb-5 flex items-center justify-between border-3 border-border bg-forest px-4 py-3">
        <span className="font-display text-[9px] text-cream/80">Saldo Poin</span>
        <span className="font-display text-lg text-mustard">{point}</span>
      </div>

      {lastCode && (
        <div className="mb-4 border-3 border-border bg-parchment px-3 py-2 text-center font-body text-lg text-ink">
          Berhasil ditukar! Kode:{" "}
          <span className="font-display text-[10px] tracking-widest text-forest">{lastCode}</span>
        </div>
      )}

      <p className="mb-2 font-display text-[10px] text-ink-soft">Katalog Voucher</p>
      <div className="flex flex-col gap-3">
        {VOUCHERS.map((v) => {
          const afford = point >= v.cost;
          return (
            <div key={v.id} className="flex items-center gap-3 border-3 border-border bg-cream px-3 py-2">
              <div className="min-w-0 flex-1">
                <p className="font-body text-xl text-ink">{v.name}</p>
                {v.description && (
                  <p className="font-body text-base text-ink-soft">{v.description}</p>
                )}
              </div>
              <span className="shrink-0 border-2 border-border bg-mustard px-2 py-0.5 font-display text-[9px] text-ink">
                {v.cost} Poin
              </span>
              <GameButton
                variant="primary"
                className="!px-4 !py-2 !text-[10px]"
                disabled={!afford}
                onClick={() => onRedeem(v.id)}
              >
                Tukar
              </GameButton>
            </div>
          );
        })}
      </div>

      <div className="my-5 border-t-2 border-line" />
      <p className="mb-2 font-display text-[10px] text-ink-soft">Voucher Saya</p>
      {redeemed.length === 0 ? (
        <p className="font-body text-lg text-ink-soft/70">Belum ada voucher ditukar.</p>
      ) : (
        <div className="flex flex-col gap-2">
          {redeemed.map((r, i) => (
            <div
              key={`${r.code}-${i}`}
              className="flex items-center justify-between border-3 border-border bg-parchment px-3 py-2"
            >
              <span className="min-w-0 flex-1 truncate font-body text-lg text-ink">{r.name}</span>
              <span className="shrink-0 border-2 border-border bg-forest px-2 py-0.5 font-display text-[9px] tracking-widest text-mustard">
                {r.code}
              </span>
            </div>
          ))}
        </div>
      )}

      <div className="mt-6 flex justify-center">
        <GameButton variant="ghost" onClick={close}>
          Tutup
        </GameButton>
      </div>
    </ModalShell>
  );
}
