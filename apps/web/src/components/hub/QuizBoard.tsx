import { useEffect, useRef, useState } from "react";
import { gameStore } from "../../stores/game.store";
import { progressRepo } from "../../lib/progressRepo";
import type { QuizCatalogQuestion, QuizResultRow, Totals } from "../../lib/progressRepo.contracts";
import { ModalShell } from "../common/ModalShell";
import { GameButton } from "../common/GameButton";

const LETTERS = ["A", "B", "C", "D"];
/** How many questions to draw per play (non-secret; server caps at the same bound). */
const QUIZ_PICK = 10;

type Phase = "loading" | "playing" | "grading" | "summary" | "error";

// The catalog is static, owner-independent data; cache it across overlay opens so a
// re-open draws a fresh run without another round-trip.
let cachedQuizPool: QuizCatalogQuestion[] | null = null;

/** Unbiased Fisher–Yates draw of up to n questions. */
function draw(pool: QuizCatalogQuestion[], n: number): QuizCatalogQuestion[] {
  const copy = [...pool];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, n);
}

/**
 * The koperasi quiz. Mounted only while activeOverlay === "QUIZ". Questions come
 * from the DB (quiz_catalog); grading is server-authoritative (submit_quiz) so the
 * answer key never reaches the client. Offline/degraded → a "needs connection"
 * state (the quiz cannot be graded without the server).
 */
export function QuizBoard() {
  const [phase, setPhase] = useState<Phase>("loading");
  const [pool, setPool] = useState<QuizCatalogQuestion[]>([]);
  const [picked, setPicked] = useState<QuizCatalogQuestion[]>([]);
  const [index, setIndex] = useState(0);
  const [choices, setChoices] = useState<(number | null)[]>([]);
  const [results, setResults] = useState<QuizResultRow[] | null>(null);
  const [awarded, setAwarded] = useState<Totals | null>(null);
  // "offline" = no server (answer key is server-only, can't grade); "retryable" = a
  // transient load/grade error that a "Coba lagi" can retry.
  const [errorKind, setErrorKind] = useState<"offline" | "retryable">("retryable");
  const retryRef = useRef<() => void>(() => {});
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const close = () => gameStore.getState().clearSelection();

  const startPlaying = (questions: QuizCatalogQuestion[]) => {
    setPool(questions);
    setPicked(draw(questions, QUIZ_PICK));
    setChoices(Array<number | null>(Math.min(QUIZ_PICK, questions.length)).fill(null));
    setIndex(0);
    setResults(null);
    setAwarded(null);
    setPhase("playing");
  };

  // Load the catalog (module-cached so re-opens don't refetch), then draw a run.
  const loadRun = async () => {
    setPhase("loading");
    if (cachedQuizPool) {
      startPlaying(cachedQuizPool);
      return;
    }
    const res = await progressRepo.fetchQuiz();
    if (!mounted.current) return;
    if (res.status === "ok" && res.data.length > 0) {
      cachedQuizPool = res.data;
      startPlaying(res.data);
    } else {
      setErrorKind(res.status === "degraded" ? "offline" : "retryable");
      retryRef.current = () => void loadRun();
      setPhase("error");
    }
  };

  useEffect(() => {
    void loadRun();
    // Run once on open; loadRun closes over stable setters only.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const question = picked[index];
  const selected = choices[index] ?? null;
  const answered = selected !== null;
  const isLast = index === picked.length - 1;

  const submitRun = async () => {
    setPhase("grading");
    const answers = picked.map((q, i) => ({ code: q.code, choice: choices[i] ?? 0 }));
    const outcome = await gameStore.getState().submitQuiz(answers);
    if (!mounted.current) return;
    if (outcome.ok) {
      setResults(outcome.results);
      setAwarded(outcome.awarded);
      setPhase("summary");
    } else {
      setErrorKind(outcome.reason === "degraded" ? "offline" : "retryable");
      retryRef.current = () => void submitRun();
      setPhase("error");
    }
  };

  const advance = () => {
    if (!answered) return;
    if (isLast) void submitRun();
    else setIndex((i) => i + 1);
  };
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  const select = (option: number) =>
    setChoices((prev) => {
      if (prev[index] !== null) return prev; // already answered this question
      const next = [...prev];
      next[index] = option;
      return next;
    });

  const restart = () => startPlaying(pool);

  // After answering, move focus to the advance button (a11y).
  useEffect(() => {
    if (phase === "playing" && answered) document.getElementById("quiz-advance")?.focus();
  }, [answered, index, phase]);

  // Keyboard: 1–4 to answer, Enter to advance. stopPropagation ONLY on consumed keys
  // so Escape/Tab still reach ModalShell.
  useEffect(() => {
    if (phase !== "playing") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key >= "1" && e.key <= "4") {
        e.preventDefault();
        e.stopPropagation();
        const n = Number(e.key) - 1;
        if (n < (question?.options.length ?? 0)) select(n); // ignore a key past the option count
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        advanceRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", onKeyDown, { capture: true });
    // `select` closes over `index`; re-subscribe per index so the right slot is set.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, index]);

  if (phase === "loading" || phase === "grading") {
    return (
      <ModalShell titleId="quiz-title" onClose={close} panelClassName="w-full max-w-lg">
        <h2 id="quiz-title" className="mb-4 text-center font-display text-sm text-forest md:text-base">
          Kuis Koperasi
        </h2>
        <p className="py-8 text-center font-body text-xl text-ink-soft">
          {phase === "loading" ? "Memuat soal…" : "Menilai jawaban…"}
        </p>
      </ModalShell>
    );
  }

  if (phase === "error") {
    return (
      <ModalShell titleId="quiz-title" onClose={close} panelClassName="w-full max-w-lg">
        <h2 id="quiz-title" className="mb-4 text-center font-display text-sm text-forest md:text-base">
          Kuis Koperasi
        </h2>
        <div className="border-3 border-border bg-cream px-6 py-6 text-center">
          {errorKind === "offline" ? (
            <>
              <p className="font-body text-xl text-ink">Kuis butuh koneksi internet.</p>
              <p className="mt-2 font-body text-lg text-ink-soft">
                Sambungkan koneksi lalu buka kuis kembali.
              </p>
            </>
          ) : (
            <>
              <p className="font-body text-xl text-ink">Gagal memuat kuis.</p>
              <p className="mt-2 font-body text-lg text-ink-soft">Coba lagi sebentar.</p>
            </>
          )}
        </div>
        <div className="mt-6 flex justify-center gap-4">
          {errorKind === "retryable" && (
            <GameButton variant="primary" onClick={() => retryRef.current()}>
              Coba Lagi
            </GameButton>
          )}
          <GameButton variant="ghost" onClick={close}>
            Tutup
          </GameButton>
        </div>
      </ModalShell>
    );
  }

  if (phase === "summary") {
    const correctCount = results?.filter((r) => r.correct).length ?? 0;
    const byCode = new Map(results?.map((r) => [r.code, r]));
    return (
      <ModalShell titleId="quiz-title" onClose={close} panelClassName="w-full max-w-lg">
        <h2 id="quiz-title" className="mb-4 text-center font-display text-sm text-forest md:text-base">
          Hasil Kuis
        </h2>
        <div className="border-3 border-border bg-cream px-6 py-5 text-center">
          <p className="font-display text-3xl text-forest md:text-4xl">
            {correctCount}/{picked.length}
          </p>
          <p className="mt-2 font-body text-xl text-ink-soft">Jawaban benar</p>
        </div>
        <div className="mt-4 flex justify-center gap-3">
          <span className="border-2 border-border bg-forest px-3 py-1 font-display text-[10px] text-cream">
            +{awarded?.xp ?? 0} XP
          </span>
          <span className="border-2 border-border bg-mustard px-3 py-1 font-display text-[10px] text-ink">
            +{awarded?.point ?? 0} Poin
          </span>
        </div>

        <div className="mt-5 flex max-h-64 flex-col gap-2 overflow-y-auto">
          {picked.map((q, i) => {
            const r = byCode.get(q.code);
            const chosen = choices[i];
            return (
              <div key={q.code} className="border-3 border-border bg-parchment px-3 py-2">
                <p className="font-body text-base text-ink">{q.prompt}</p>
                <p className="mt-1 font-body text-base text-ink-soft">
                  Jawabanmu: {chosen !== null && chosen !== undefined ? q.options[chosen] : "—"}
                </p>
                <p className="mt-1 font-display text-[9px] text-forest">
                  {r?.correct ? "✓ Benar" : "✗ Kurang tepat"}
                  {r?.alreadyCredited && (
                    <span className="ml-2 text-ink-soft">· sudah dikreditkan</span>
                  )}
                </p>
                {r?.explanation && (
                  <p className="mt-1 font-body text-base text-ink-soft">{r.explanation}</p>
                )}
              </div>
            );
          })}
        </div>

        <div className="mt-6 flex justify-center gap-4">
          <GameButton variant="primary" onClick={restart}>
            Main Lagi
          </GameButton>
          <GameButton variant="ghost" onClick={close}>
            Tutup
          </GameButton>
        </div>
      </ModalShell>
    );
  }

  // phase === "playing"
  const answeredCount = choices.filter((c) => c !== null).length;
  return (
    <ModalShell titleId="quiz-title" onClose={close} panelClassName="w-full max-w-lg">
      <div className="mb-3 flex items-center justify-between gap-3">
        <span
          id="quiz-title"
          className="border-2 border-border bg-mustard px-2 py-0.5 font-display text-[9px] text-ink"
        >
          Soal {index + 1}/{picked.length}
        </span>
        <span className="border-2 border-border bg-forest px-2 py-0.5 font-display text-[9px] text-cream">
          Terjawab {answeredCount}
        </span>
      </div>

      {/* Progress segments */}
      <div className="mb-4 flex gap-1">
        {picked.map((_, i) => (
          <span
            key={i}
            className={`h-2 flex-1 border-2 border-border ${
              i < index ? "bg-forest" : i === index ? "bg-mustard" : "bg-cream"
            }`}
          />
        ))}
      </div>

      <div
        key={index}
        className="mb-5 flex min-h-24 animate-[fadeIn_120ms_ease-out] items-center justify-center border-3 border-border bg-cream px-5 py-6 text-center"
      >
        <p className="font-body text-xl leading-snug text-ink md:text-2xl">{question?.prompt}</p>
      </div>

      <div className="flex flex-col gap-3" role="radiogroup" aria-label="Pilihan jawaban">
        {question?.options.map((opt, i) => {
          const isChosen = i === selected;
          const state = isChosen
            ? "border-3 border-border bg-forest text-cream"
            : "pixel-raise active:pixel-press bg-cream text-ink hover:bg-parchment";
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={isChosen}
              disabled={answered}
              onClick={() => select(i)}
              className={`flex w-full items-center gap-3 px-4 py-3 text-left font-body text-lg focus-visible:pixel-focus focus-visible:outline-none disabled:cursor-default md:text-xl ${state}`}
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center border-2 border-border bg-mustard font-display text-[9px] text-ink">
                {LETTERS[i]}
              </span>
              {opt}
            </button>
          );
        })}
      </div>

      <div className="mt-5 flex justify-end">
        <GameButton id="quiz-advance" variant="primary" disabled={!answered} onClick={advance}>
          {isLast ? "Lihat Hasil" : "Lanjut ›"}
        </GameButton>
      </div>
    </ModalShell>
  );
}
