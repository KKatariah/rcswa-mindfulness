import type { APIRequestContext, Page } from "@playwright/test";

export const API = "http://127.0.0.1:8001/api";
export const PASSWORD = "Calm-River-42";
export const STUDENT = "student@e2e.local";
export const OTHER = "other@e2e.local";

// Reuse one token per user: /api/login/ allows only 10 attempts a minute per IP.
const tokens = new Map<string, string>();

export async function apiToken(request: APIRequestContext, email: string): Promise<string> {
	const cached = tokens.get(email);
	if (cached) return cached;
	const res = await request.post(`${API}/login/`, { data: { email, password: PASSWORD } });
	if (!res.ok()) throw new Error(`login failed for ${email}: ${res.status()} ${await res.text()}`);
	const token = (await res.json()).token;
	tokens.set(email, token);
	return token;
}

/** Log in through the API and hand the token to the app, skipping the login form. */
export async function loginAs(page: Page, request: APIRequestContext, email: string): Promise<string> {
	const token = await apiToken(request, email);
	await page.addInitScript((t) => window.localStorage.setItem("token", t), token);
	return token;
}
