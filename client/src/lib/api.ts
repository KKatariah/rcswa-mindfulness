const API_BASE_URL = "http://127.0.0.1:8000/api";

type LoginPayload = { email: string; password: string };
type RegisterPayload = { email: string; full_name: string; password: string };

type AuthUser = { id: number; email: string; full_name: string };
type AuthResponse = { message: string; token: string; user: AuthUser };

async function handleResponse<T>(res: Response): Promise<T> {
	const data = await res.json();
	if (!res.ok) {
		const message = typeof data === "object" && data !== null
			? Object.values(data).flat().join(" ")
			: "Something went wrong";
		throw new Error(message);
	}
	return data as T;
}

export async function loginUser(payload: LoginPayload): Promise<AuthResponse> {
	const res = await fetch(`${API_BASE_URL}/login/`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
	const data = await handleResponse<AuthResponse>(res);
	localStorage.setItem("token", data.token);
	return data;
}

export async function registerUser(payload: RegisterPayload): Promise<{ message: string; user: AuthUser }> {
	const res = await fetch(`${API_BASE_URL}/register/`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify(payload),
	});
	return handleResponse<{ message: string; user: AuthUser }>(res);
}

export async function logoutUser(): Promise<void> {
	const token = localStorage.getItem("token");
	await fetch(`${API_BASE_URL}/logout/`, {
		method: "POST",
		headers: { Authorization: `Token ${token}` },
	});
	localStorage.removeItem("token");
}

// ── Modules ────────────────────────────────────────────────────────────────────

export type ApiModule = { id: number; week_number: number; title: string };

export async function listModules(token: string): Promise<ApiModule[]> {
	const res = await fetch(`${API_BASE_URL}/modules/`, {
		headers: { Authorization: `Token ${token}` },
	});
	return handleResponse<ApiModule[]>(res);
}

// ── Forum ──────────────────────────────────────────────────────────────────────

import type { ForumPost, ForumThread, ForumThreadDetail } from "@/types/forum";

function authHeader(token: string) {
	return { Authorization: `Token ${token}`, "Content-Type": "application/json" };
}

async function deleteRequest(url: string, token: string): Promise<void> {
	const res = await fetch(url, { method: "DELETE", headers: { Authorization: `Token ${token}` } });
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		const message = typeof data === "object" && data !== null
			? Object.values(data).flat().join(" ")
			: "Something went wrong";
		throw new Error(message);
	}
}

export async function listForumThreads(token: string): Promise<ForumThread[]> {
	const res = await fetch(`${API_BASE_URL}/forum/threads/`, {
		headers: { Authorization: `Token ${token}` },
	});
	return handleResponse<ForumThread[]>(res);
}

export async function getForumThread(id: number, token: string): Promise<ForumThreadDetail> {
	const res = await fetch(`${API_BASE_URL}/forum/threads/${id}/`, {
		headers: { Authorization: `Token ${token}` },
	});
	return handleResponse<ForumThreadDetail>(res);
}

export async function createForumThread(
	data: { body: string; module?: number; content_item?: number },
	token: string,
): Promise<ForumThread> {
	const res = await fetch(`${API_BASE_URL}/forum/threads/`, {
		method: "POST",
		headers: authHeader(token),
		body: JSON.stringify(data),
	});
	return handleResponse<ForumThread>(res);
}

export async function pinForumThread(id: number, is_pinned: boolean, token: string): Promise<ForumThread> {
	const res = await fetch(`${API_BASE_URL}/forum/threads/${id}/`, {
		method: "PATCH",
		headers: authHeader(token),
		body: JSON.stringify({ is_pinned }),
	});
	return handleResponse<ForumThread>(res);
}

export async function updateForumThread(
	id: number,
	data: { title: string },
	token: string,
): Promise<ForumThread> {
	const res = await fetch(`${API_BASE_URL}/forum/threads/${id}/`, {
		method: "PATCH",
		headers: authHeader(token),
		body: JSON.stringify(data),
	});
	return handleResponse<ForumThread>(res);
}

export async function deleteForumThread(id: number, token: string): Promise<void> {
	return deleteRequest(`${API_BASE_URL}/forum/threads/${id}/`, token);
}

export async function createForumPost(
	data: { thread: number; body: string; parent_post?: number },
	token: string,
): Promise<ForumPost> {
	const res = await fetch(`${API_BASE_URL}/forum/posts/`, {
		method: "POST",
		headers: authHeader(token),
		body: JSON.stringify(data),
	});
	return handleResponse<ForumPost>(res);
}

export async function updateForumPost(
	id: number,
	data: { body: string },
	token: string,
): Promise<ForumPost> {
	const res = await fetch(`${API_BASE_URL}/forum/posts/${id}/`, {
		method: "PATCH",
		headers: authHeader(token),
		body: JSON.stringify(data),
	});
	return handleResponse<ForumPost>(res);
}

export async function deleteForumPost(id: number, token: string): Promise<void> {
	return deleteRequest(`${API_BASE_URL}/forum/posts/${id}/`, token);
}