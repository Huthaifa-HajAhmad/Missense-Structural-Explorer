import React, { Component, ErrorInfo, ReactNode } from "react";
import { ShieldAlert, RefreshCw } from "lucide-react";

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  name?: string;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error(`[ErrorBoundary: ${this.props.name || "Global"}] Unhandled error:`, error, errorInfo);
    this.props.onError?.(error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      const errMsg = String(this.state.error?.message || this.state.error || "").toLowerCase();
      const isChunkError =
        errMsg.includes("failed to fetch dynamically imported module") ||
        errMsg.includes("importing a module script failed") ||
        errMsg.includes("error loading dynamically imported module");

      if (isChunkError) {
        return (
          <div className="p-6 rounded-xl border border-indigo-500/30 bg-indigo-50/50 dark:bg-indigo-950/20 text-slate-800 dark:text-slate-200 max-w-lg mx-auto my-8 shadow-xl flex flex-col items-center justify-center text-center">
            <RefreshCw className="w-10 h-10 text-indigo-600 dark:text-indigo-400 mb-3 animate-spin-slow" />
            <h3 className="text-base font-black text-indigo-800 dark:text-indigo-300 uppercase tracking-wider font-mono mb-2">
              New Application Version Deployed
            </h3>
            <p className="text-xs text-slate-600 dark:text-slate-400 mb-4 leading-relaxed max-w-sm">
              A newer version of the 3D Mol* Viewer has been deployed. Please reload the application to fetch updated components.
            </p>
            <button
              onClick={this.handleReload}
              className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-xs font-semibold font-mono tracking-wider uppercase transition active:scale-95 cursor-pointer shadow-md"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              Reload Application
            </button>
          </div>
        );
      }

      return (
        <div className="p-6 rounded-xl border border-rose-500/30 bg-rose-50/50 dark:bg-rose-950/20 text-slate-800 dark:text-slate-200 max-w-lg mx-auto my-8 shadow-xl flex flex-col items-center justify-center text-center">
          <ShieldAlert className="w-10 h-10 text-rose-600 dark:text-rose-400 mb-3 animate-pulse" />
          <h3 className="text-base font-black text-rose-800 dark:text-rose-300 uppercase tracking-wider font-mono mb-2">
            Component Render Failed
          </h3>
          <p className="text-xs text-slate-600 dark:text-slate-400 mb-4 leading-relaxed max-w-sm">
            An unexpected error occurred while rendering the {this.props.name || "application"} interface. 
          </p>
          {this.state.error && (
            <details className="w-full text-left text-[10px] mb-4 bg-slate-100 dark:bg-black/45 border border-slate-300 dark:border-slate-800 rounded-lg p-2.5 cursor-pointer">
              <summary className="font-bold text-slate-700 dark:text-slate-300 hover:text-rose-600 dark:hover:text-white select-none mb-1 font-mono text-[9px] uppercase tracking-wide">
                Error Stack Details
              </summary>
              <pre className="font-mono text-rose-700 dark:text-rose-300 overflow-auto max-h-[150px] whitespace-pre-wrap leading-normal pt-1 border-t border-slate-200 dark:border-slate-850">
                {this.state.error.stack || this.state.error.message || String(this.state.error)}
              </pre>
            </details>
          )}
          <button
            onClick={this.handleReset}
            className="flex items-center gap-2 px-4 py-2 bg-rose-600 hover:bg-rose-700 dark:bg-indigo-600 dark:hover:bg-indigo-500 text-white rounded-lg text-xs font-semibold font-mono tracking-wider uppercase transition active:scale-95 cursor-pointer shadow-md"
          >
            <RefreshCw className="w-3.5 h-3.5 animate-spin-slow" />
            Reset Interface
          </button>
        </div>
      );
    }

    return this.props.children;
  }
}
