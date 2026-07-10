import { useState } from "react";
import { PixelPanel } from "../common/PixelPanel";
import { GameButton } from "../common/GameButton";

/** Top-left "?" icon that opens a how-to-play panel over the hub. */
export function HubGuide() {
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Panduan bermain"
        className="pixel-raise active:pixel-press pointer-events-auto absolute left-4 top-4 z-20 h-12 w-12 bg-mustard font-display text-lg text-ink focus-visible:pixel-focus focus-visible:outline-none"
      >
        ?
      </button>

      {open && (
        <div
          className="absolute inset-0 z-30 flex items-center justify-center bg-ink/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div onClick={(e) => e.stopPropagation()}>
            <PixelPanel className="max-w-md text-left">
              <h2 className="mb-4 text-center font-display text-base text-forest">
                Panduan Bermain
              </h2>
              <ul className="mb-6 space-y-3 font-body text-xl text-ink-soft">
                <li>
                  • <b className="text-ink">WASD</b> atau{" "}
                  <b className="text-ink">panah</b> untuk bergerak.
                </li>
                <li>
                  • Dekati pintu Kantor Koperasi lalu tekan{" "}
                  <b className="text-ink">E</b> (atau klik pintunya) untuk masuk.
                </li>
                <li>• Di dalam, pilih ruangan untuk memulai skenario.</li>
                <li>
                  • Tombol <b className="text-ink">Keluar</b> (kanan atas) untuk
                  kembali ke menu.
                </li>
              </ul>
              <div className="text-center">
                <GameButton variant="primary" onClick={() => setOpen(false)}>
                  Mengerti
                </GameButton>
              </div>
            </PixelPanel>
          </div>
        </div>
      )}
    </>
  );
}
