import { useState } from "react";
import { useGameStore, gameStore } from "../../stores/game.store";
import {
  MISSIONS,
  type Mission,
  type MissionKind,
  type RealLifeMission,
} from "../../content/missions";
import { ModalShell } from "../common/ModalShell";
import { GameButton } from "../common/GameButton";

function RewardChips({ xp, point }: { xp: number; point: number }) {
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <span className="border-2 border-border bg-forest px-2 py-0.5 font-display text-[9px] text-mustard">
        +{xp} XP
      </span>
      <span className="border-2 border-border bg-mustard px-2 py-0.5 font-display text-[9px] text-ink">
        +{point} Poin
      </span>
    </div>
  );
}

function DoneBadge() {
  return (
    <span className="shrink-0 border-2 border-border bg-forest px-3 py-1 font-display text-[9px] text-cream">
      Selesai ✓
    </span>
  );
}

function GameMissionCard({ mission, done }: { mission: Mission; done: boolean }) {
  return (
    <div className={`flex items-start gap-3 border-3 border-border bg-cream px-4 py-3 ${done ? "opacity-70" : ""}`}>
      <div className="min-w-0 flex-1">
        <p className="font-display text-[11px] text-forest">{mission.title}</p>
        <p className="mt-1 font-body text-lg text-ink-soft">{mission.description}</p>
        <RewardChips xp={mission.reward.xp} point={mission.reward.point} />
      </div>
      {done ? (
        <DoneBadge />
      ) : (
        <GameButton
          variant="primary"
          className="!px-4 !py-2 !text-[10px]"
          onClick={() => gameStore.getState().completeMission(mission.id)}
        >
          Klaim
        </GameButton>
      )}
    </div>
  );
}

function RealLifeMissionCard({ mission, done }: { mission: RealLifeMission; done: boolean }) {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    const result = gameStore.getState().completeMission(mission.id, code);
    if (!result.ok && result.reason === "wrong-code") setError("Kode salah");
  };

  return (
    <div className={`border-3 border-border bg-cream px-4 py-3 ${done ? "opacity-70" : ""}`}>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="font-display text-[11px] text-forest">{mission.title}</p>
          <p className="mt-1 font-body text-lg text-ink-soft">{mission.description}</p>
          <RewardChips xp={mission.reward.xp} point={mission.reward.point} />
        </div>
        {done && <DoneBadge />}
      </div>

      {!done && (
        <form
          className="mt-3 flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            submit();
          }}
        >
          <input
            value={code}
            onChange={(e) => {
              setCode(e.target.value);
              if (error) setError(null);
            }}
            placeholder="Masukkan kode"
            autoCapitalize="characters"
            spellCheck={false}
            aria-label={`Kode untuk ${mission.title}`}
            aria-invalid={error !== null}
            className="min-w-0 flex-1 border-3 border-border bg-parchment px-3 py-2 font-body text-xl text-ink placeholder:text-ink-soft/60 focus-visible:pixel-focus focus-visible:outline-none"
          />
          <GameButton variant="primary" type="submit" className="!px-4 !py-2 !text-[10px]">
            Klaim
          </GameButton>
        </form>
      )}
      {error && <p className="mt-2 font-body text-lg text-orange">{error}</p>}
    </div>
  );
}

const TAB_LABEL: Record<MissionKind, string> = { game: "Game", reallife: "Real-Life" };

/** The mission overlay: two tabs (Game | Real-Life), mounted only while active. */
export function MissionBoard() {
  const completedIds = useGameStore((s) => s.completedMissionIds);
  const [tab, setTab] = useState<MissionKind>("game");

  const close = () => gameStore.getState().clearSelection();
  const isDone = (id: string) => completedIds.includes(id);
  const list = MISSIONS.filter((m) => m.kind === tab);

  return (
    <ModalShell titleId="mission-title" onClose={close} panelClassName="w-full max-w-lg">
      <h2 id="mission-title" className="mb-4 text-center font-display text-sm text-forest md:text-base">
        Mission
      </h2>

      <div className="mb-4 flex gap-2">
        {(["game", "reallife"] as const).map((k) => (
          <button
            key={k}
            type="button"
            onClick={() => setTab(k)}
            className={`flex-1 border-3 border-border px-3 py-2 font-display text-[10px] focus-visible:pixel-focus focus-visible:outline-none ${
              tab === k
                ? "pixel-press bg-forest text-cream"
                : "pixel-raise bg-cream-2 text-forest hover:bg-parchment"
            }`}
          >
            {TAB_LABEL[k]}
          </button>
        ))}
      </div>

      <div className="flex flex-col gap-3">
        {list.map((mission) =>
          mission.kind === "reallife" ? (
            <RealLifeMissionCard key={mission.id} mission={mission} done={isDone(mission.id)} />
          ) : (
            <GameMissionCard key={mission.id} mission={mission} done={isDone(mission.id)} />
          ),
        )}
      </div>

      <div className="mt-6 flex justify-center">
        <GameButton variant="ghost" onClick={close}>
          Tutup
        </GameButton>
      </div>
    </ModalShell>
  );
}
