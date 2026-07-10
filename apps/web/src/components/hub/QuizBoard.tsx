import { useEffect, useReducer, useRef } from "react";
import { gameStore } from "../../stores/game.store";
import {
  QUIZ_QUESTIONS,
  QUIZ_PICK,
  POINT_PER_CORRECT,
  XP_PER_QUESTION,
  type QuizQuestion,
} from "../../content/quiz";
import { ModalShell } from "../common/ModalShell";
import { GameButton } from "../common/GameButton";

const LETTERS = ["A", "B", "C", "D"];

/** Unbiased Fisher–Yates; returns a fresh 10-question run. */
function pickRun(): QuizQuestion[] {
  const copy = [...QUIZ_QUESTIONS];
  for (let i = copy.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [copy[i], copy[j]] = [copy[j]!, copy[i]!];
  }
  return copy.slice(0, QUIZ_PICK);
}

type QuizRun = {
  picked: QuizQuestion[];
  index: number;
  selected: number | null;
  correctCount: number;
  phase: "playing" | "summary";
};

type Action =
  | { type: "SELECT"; option: number }
  | { type: "NEXT" }
  | { type: "SUMMARY" }
  | { type: "RESTART" };

function startRun(): QuizRun {
  return { picked: pickRun(), index: 0, selected: null, correctCount: 0, phase: "playing" };
}

function reducer(state: QuizRun, action: Action): QuizRun {
  switch (action.type) {
    case "SELECT": {
      if (state.selected !== null) return state; // already answered this question
      const correct = action.option === state.picked[state.index]!.correctIndex;
      return {
        ...state,
        selected: action.option,
        correctCount: state.correctCount + (correct ? 1 : 0),
      };
    }
    case "NEXT":
      return { ...state, index: state.index + 1, selected: null };
    case "SUMMARY":
      return { ...state, phase: "summary" };
    case "RESTART":
      return startRun();
  }
}

/**
 * The koperasi quiz. Mounted only while activeOverlay === "QUIZ" (see HubPage),
 * so closing unmounts it and reopening starts a fresh run — abandoning mid-quiz
 * banks nothing. Rewards commit exactly once (committedRef) on reaching summary.
 */
export function QuizBoard() {
  const [run, dispatch] = useReducer(reducer, undefined, startRun);
  const committedRef = useRef(false);

  const { picked, index, selected, correctCount, phase } = run;
  const question = picked[index]!;
  const answered = selected !== null;
  const isLast = index === picked.length - 1;
  const earnedXp = picked.length * XP_PER_QUESTION;
  const earnedPoint = correctCount * POINT_PER_CORRECT;

  const close = () => gameStore.getState().clearSelection();

  const goSummary = () => {
    if (committedRef.current) return; // synchronous latch — commit exactly once
    committedRef.current = true;
    gameStore.getState().addQuizRewards({ xp: earnedXp, point: earnedPoint });
    dispatch({ type: "SUMMARY" });
  };
  const advance = () => {
    if (!answered) return;
    if (isLast) goSummary();
    else dispatch({ type: "NEXT" });
  };
  const restart = () => {
    committedRef.current = false;
    dispatch({ type: "RESTART" });
  };

  // Keep the latest advance() reachable from the once-attached key listener
  // without re-subscribing every render (avoids stale closures).
  const advanceRef = useRef(advance);
  advanceRef.current = advance;

  // After answering, move focus to the advance button (a11y + queues the reveal
  // announcement for screen readers).
  useEffect(() => {
    if (phase === "playing" && answered) document.getElementById("quiz-advance")?.focus();
  }, [answered, index, phase]);

  // Keyboard: 1–4 to answer, Enter to advance. stopPropagation ONLY on consumed
  // keys so Escape/Tab still reach ModalShell.
  useEffect(() => {
    if (phase !== "playing") return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key >= "1" && e.key <= "4") {
        e.preventDefault();
        e.stopPropagation();
        dispatch({ type: "SELECT", option: Number(e.key) - 1 });
      } else if (e.key === "Enter") {
        e.preventDefault();
        e.stopPropagation();
        advanceRef.current();
      }
    };
    document.addEventListener("keydown", onKeyDown, { capture: true });
    return () => document.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [phase]);

  if (phase === "summary") {
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
            +{earnedXp} XP
          </span>
          <span className="border-2 border-border bg-mustard px-3 py-1 font-display text-[10px] text-ink">
            +{earnedPoint} Poin
          </span>
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
          Skor {correctCount}
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
        <p className="font-body text-xl leading-snug text-ink md:text-2xl">{question.question}</p>
      </div>

      <div className="flex flex-col gap-3" role="radiogroup" aria-label="Pilihan jawaban">
        {question.options.map((opt, i) => {
          const isCorrect = i === question.correctIndex;
          const isChosen = i === selected;
          let state = "pixel-raise active:pixel-press bg-cream text-ink hover:bg-parchment";
          if (answered) {
            if (isCorrect) state = "border-3 border-border bg-forest text-cream";
            else if (isChosen) state = "border-3 border-border bg-orange text-ink";
            else state = "border-3 border-line bg-cream text-ink-soft opacity-70";
          }
          return (
            <button
              key={i}
              type="button"
              role="radio"
              aria-checked={isChosen}
              disabled={answered}
              onClick={() => dispatch({ type: "SELECT", option: i })}
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

      {answered && (
        <div
          aria-live="polite"
          role="status"
          className="mt-4 border-3 border-border bg-parchment px-4 py-3 text-center font-body text-lg text-ink-soft"
        >
          <span className="font-display text-[10px] text-forest">
            {selected === question.correctIndex ? "✓ Benar!" : "✗ Kurang tepat"}
          </span>
          {question.explanation && <p className="mt-2">{question.explanation}</p>}
        </div>
      )}

      <div className="mt-5 flex justify-end">
        <GameButton id="quiz-advance" variant="primary" disabled={!answered} onClick={advance}>
          {isLast ? "Lihat Hasil" : "Lanjut ›"}
        </GameButton>
      </div>
    </ModalShell>
  );
}
