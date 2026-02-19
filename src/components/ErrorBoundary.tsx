import React from "react";

type ErrorBoundaryProps = {
  children: React.ReactNode;
};

type ErrorBoundaryState = {
  hasError: boolean;
  message: string;
};

export class ErrorBoundary extends React.Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, message: "" };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error?.message || "Unknown runtime error",
    };
  }

  componentDidCatch(error: Error) {
    console.error("ForgeOS runtime crash:", error);
  }

  render() {
    if(!this.state.hasError) return this.props.children;

    return (
      <div style={{ minHeight: "100vh", background: "#0a0a0a", color: "#f5f5f5", padding: 24, fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace" }}>
        <div style={{ fontSize: 16, fontWeight: 700, marginBottom: 8 }}>ForgeOS runtime error</div>
        <div style={{ fontSize: 12, opacity: 0.8, marginBottom: 12 }}>The app encountered an unexpected error. Reload, then check console/network config if this continues.</div>
        <pre style={{ whiteSpace: "pre-wrap", background: "#111", border: "1px solid #222", padding: 12, borderRadius: 6 }}>{this.state.message}</pre>
      </div>
    );
  }
}
