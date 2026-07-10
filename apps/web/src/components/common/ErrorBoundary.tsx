import { Component, type ErrorInfo, type ReactNode } from "react";

type Props = { children: ReactNode };
type State = { hasError: boolean };

/**
 * Top-level error boundary. Guarantees the app never shows a blank screen —
 * on any render error it shows a readable Indonesian fallback with a reload
 * action.
 */
export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  override componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Terjadi kesalahan pada aplikasi:", error, info);
  }

  override render(): ReactNode {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <div className="koperasi-bg flex min-h-screen items-center justify-center p-4">
        <div className="pixel-panel max-w-md bg-cream-2 p-8 text-center">
          <h1 className="mb-4 font-display text-lg text-forest">
            Terjadi Kesalahan
          </h1>
          <p className="mb-6 font-body text-xl text-ink-soft">
            Maaf, terjadi kesalahan yang tidak terduga. Silakan muat ulang
            halaman untuk melanjutkan.
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="pixel-raise bg-mustard px-6 py-3 font-display text-sm text-ink focus-visible:pixel-focus focus-visible:outline-none active:pixel-press"
          >
            Muat Ulang
          </button>
        </div>
      </div>
    );
  }
}
