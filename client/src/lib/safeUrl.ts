/**
 * Returns `url` only if it is safe to put in an `href` or `src`: an http(s) URL
 * or a same-site path. Anything else (javascript:, data:, garbage) becomes
 * undefined, so the caller shows its fallback instead.
 */
export function safeUrl(url?: string | null): string | undefined {
	const value = url?.trim();
	if (!value) return undefined;
	if (value.startsWith("/") && !value.startsWith("//")) return value;
	try {
		const { protocol } = new URL(value);
		return protocol === "https:" || protocol === "http:" ? value : undefined;
	} catch {
		return undefined;
	}
}
