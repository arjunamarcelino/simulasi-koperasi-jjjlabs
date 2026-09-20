import { afterEach, describe, expect, it, vi } from "vitest";

/** Memory-backed Storage stub, optionally pre-seeded. */
function memStorage(seed: Record<string, string> = {}): Storage {
  const map = new Map<string, string>(Object.entries(seed));
  return {
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, String(v)),
    removeItem: (k) => void map.delete(k),
    clear: () => map.clear(),
    key: (i) => [...map.keys()][i] ?? null,
    get length() {
      return map.size;
    },
  };
}

/** Import a fresh game.store over a stubbed (seeded) localStorage. */
async function loadStore(seed: Record<string, string>) {
  vi.resetModules();
  const storage = memStorage(seed);
  vi.stubGlobal("window", { localStorage: storage });
  const mod = await import("./game.store");
  return { gameStore: mod.gameStore, storage };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("game.store — wallet owner (cross-account bleed guard)", () => {
  it("W1 adopt: first run with no recorded owner keeps the existing wallet", async () => {
    const { gameStore, storage } = await loadStore({
      "koperasi.xp": "120",
      "koperasi.point": "40",
    });
    expect(gameStore.getState().xp).toBe(120);

    gameStore.getState().syncWalletOwner("user-A");

    expect(gameStore.getState().xp).toBe(120); // adopted, not wiped
    expect(storage.getItem("koperasi.walletOwner")).toBe("user-A");
  });

  it("W2 same account (guest→Google keeps uid): no reset", async () => {
    const { gameStore } = await loadStore({
      "koperasi.xp": "120",
      "koperasi.walletOwner": "user-A",
    });

    gameStore.getState().syncWalletOwner("user-A");

    expect(gameStore.getState().xp).toBe(120);
  });

  it("W3 switch: a different account wipes the wallet (memory + storage)", async () => {
    const { gameStore, storage } = await loadStore({
      "koperasi.xp": "120",
      "koperasi.point": "40",
      "koperasi.vouchers": "[]",
      "koperasi.missions": "[]",
      "koperasi.walletOwner": "user-A",
    });
    expect(gameStore.getState().xp).toBe(120);

    gameStore.getState().syncWalletOwner("user-B");

    expect(gameStore.getState().xp).toBe(0);
    expect(gameStore.getState().point).toBe(0);
    expect(gameStore.getState().redeemedVouchers).toEqual([]);
    expect(gameStore.getState().completedMissionIds).toEqual([]);
    expect(storage.getItem("koperasi.xp")).toBe("0");
    expect(storage.getItem("koperasi.walletOwner")).toBe("user-B");
  });
});
