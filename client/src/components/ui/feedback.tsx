import type { ReactNode } from "react";

export function LoadingState({ className = "py-16" }: { className?: string }) {
	return (
		<div className={`flex justify-center ${className}`}>
			<span className="text-sm text-muted">Loading…</span>
		</div>
	);
}

/** A red box for an action that failed (as opposed to FormError inside a form). */
export function ErrorBanner({ children, className = "" }: { children: ReactNode; className?: string }) {
	return (
		<p className={`rounded-xl border border-red-200 bg-red-50 p-3 text-sm text-red-600 ${className}`} role="alert">
			{children}
		</p>
	);
}

/** A single centred line filling the screen: loading, not found, or signed out. */
export function FullPageMessage({ children }: { children: ReactNode }) {
	return (
		<div className="flex min-h-screen items-center justify-center p-6">
			<p className="text-ink-soft">{children}</p>
		</div>
	);
}
