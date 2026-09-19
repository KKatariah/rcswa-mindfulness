const API_BASE_URL = "http://127.0.0.1:8000/api";

type LoginPayload = { email: string; password: string };
type RegisterPayload = { email: string; full_name: string; password: string };

type AuthUser = { id: number; email: string; full_name: string; display_name?: string; auth_provider?: string; cohort_start_date?: string | null };
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

export type ApiContentItem = {
	id: number;
	title: string;
	type: "video" | "audio";
	provider: string;
	embed_url: string;
	display_order: number;
};

export type ApiModule = { id: number; week_number: number; title: string; content_items: ApiContentItem[] };

export type ApiModuleDetail = ApiModule & { description: string };

export async function listModules(token: string): Promise<ApiModule[]> {
	const res = await fetch(`${API_BASE_URL}/modules/`, {
		headers: { Authorization: `Token ${token}` },
	});
	return handleResponse<ApiModule[]>(res);
}

export async function getModule(id: number | string, token: string): Promise<ApiModuleDetail> {
	const res = await fetch(`${API_BASE_URL}/modules/${id}/`, {
		headers: { Authorization: `Token ${token}` },
	});
	return handleResponse<ApiModuleDetail>(res);
}

export type ApiContentCompletion = { id: number; user: number; content_item: number; completed_at: string };

export async function listProgress(token: string): Promise<ApiContentCompletion[]> {
	const res = await fetch(`${API_BASE_URL}/progress/`, {
		headers: { Authorization: `Token ${token}` },
	});
	return handleResponse<ApiContentCompletion[]>(res);
}

export async function markContentComplete(contentItemId: number, token: string): Promise<ApiContentCompletion> {
	const res = await fetch(`${API_BASE_URL}/progress/`, {
		method: "POST",
		headers: { Authorization: `Token ${token}`, "Content-Type": "application/json" },
		body: JSON.stringify({ content_item: contentItemId }),
	});
	return handleResponse<ApiContentCompletion>(res);
}

export async function deleteContentCompletion(completionId: number, token: string): Promise<void> {
	const res = await fetch(`${API_BASE_URL}/progress/${completionId}/`, {
		method: "DELETE",
		headers: { Authorization: `Token ${token}` },
	});
	if (!res.ok) {
		throw new Error("Failed to unmark completion");
	}
}

export type ApiModuleView = { id: number; user: number; module: number; viewed_at: string };

export async function listModuleViews(token: string): Promise<ApiModuleView[]> {
	const res = await fetch(`${API_BASE_URL}/content-views/`, {
		headers: { Authorization: `Token ${token}` },
	});
	return handleResponse<ApiModuleView[]>(res);
}

export async function markModuleViewed(moduleId: number, token: string): Promise<ApiModuleView> {
	const res = await fetch(`${API_BASE_URL}/content-views/`, {
		method: "POST",
		headers: { Authorization: `Token ${token}`, "Content-Type": "application/json" },
		body: JSON.stringify({ module: moduleId }),
	});
	return handleResponse<ApiModuleView>(res);
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

export async function loginWithGoogle(credential: string): Promise<AuthResponse> {
	const res = await fetch(`${API_BASE_URL}/google-login/`, {
		method: "POST",
		headers: { "Content-Type": "application/json" },
		body: JSON.stringify({ credential }),
	});
	const data = await handleResponse<AuthResponse>(res);
	localStorage.setItem("token", data.token);
	return data;
}

export async function getCurrentUser(): Promise<{ user: AuthUser }> {
	const token = localStorage.getItem("token");
	if (!token) {
		throw new Error("No token");
	}
	const res = await fetch(`${API_BASE_URL}/user/`, {
		method: "GET",
		headers: { Authorization: `Token ${token}` },
	});
	return handleResponse<{ user: AuthUser }>(res);
}

export async function updateProfile(payload: { display_name: string }, token: string) {
	const res = await fetch(`${API_BASE_URL}/profile/`, {
		method: "PATCH",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Token ${token}`,
		},
		body: JSON.stringify(payload),
	});
	return handleResponse(res);
}

export async function changePassword(
	payload: { current_password: string; new_password: string },
	token: string
) {
	const res = await fetch(`${API_BASE_URL}/change-password/`, {
		method: "POST",
		headers: {
			"Content-Type": "application/json",
			Authorization: `Token ${token}`,
		},
		body: JSON.stringify(payload),
	});
	return handleResponse<{ message: string; token: string }>(res);
}