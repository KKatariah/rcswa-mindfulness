import type { AuthUser } from "@/types/user";

export const API_BASE_URL =
	process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000/api";

type LoginPayload = { email: string; password: string };
type RegisterPayload = { email: string; full_name: string; password: string };

type AuthResponse = { message: string; token: string; user: AuthUser };

async function handleResponse<T>(res: Response): Promise<T> {
	const data = await res.json();
	if (!res.ok) {
		const message =
			typeof data === "object" && data !== null
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

export async function registerUser(
	payload: RegisterPayload,
): Promise<{ message: string; user: AuthUser }> {
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

export type ApiModule = {
	id: number;
	week_number: number;
	title: string;
	// ISO date the student's cohort reaches this week; null when not in an active cohort.
	unlock_at: string | null;
	is_unlocked: boolean;
	content_items: ApiContentItem[];
};

export type ApiModuleDetail = ApiModule & { description: string };

export async function listModules(token: string): Promise<ApiModule[]> {
	const res = await fetch(`${API_BASE_URL}/modules/`, {
		headers: { Authorization: `Token ${token}` },
	});
	return handleResponse<ApiModule[]>(res);
}

export async function getModule(
	id: number | string,
	token: string,
): Promise<ApiModuleDetail> {
	const res = await fetch(`${API_BASE_URL}/modules/${id}/`, {
		headers: { Authorization: `Token ${token}` },
	});
	return handleResponse<ApiModuleDetail>(res);
}

export type ApiModuleSummary = { id: number; week_number: number; title: string; summary: string };

export async function listModuleSummaries(): Promise<ApiModuleSummary[]> {
  const res = await fetch(`${API_BASE_URL}/modules/summary/`);
  return handleResponse<ApiModuleSummary[]>(res);
}

export type ApiContentCompletion = {
  id: number;
  user: number;
  content_item: number;
  completed_at: string;
};

export async function listProgress(
	token: string,
): Promise<ApiContentCompletion[]> {
	const res = await fetch(`${API_BASE_URL}/progress/`, {
		headers: { Authorization: `Token ${token}` },
	});
	return handleResponse<ApiContentCompletion[]>(res);
}

export async function markContentComplete(
	contentItemId: number,
	token: string,
): Promise<ApiContentCompletion> {
	const res = await fetch(`${API_BASE_URL}/progress/`, {
		method: "POST",
		headers: {
			Authorization: `Token ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ content_item: contentItemId }),
	});
	return handleResponse<ApiContentCompletion>(res);
}

export async function deleteContentCompletion(
	completionId: number,
	token: string,
): Promise<void> {
	const res = await fetch(`${API_BASE_URL}/progress/${completionId}/`, {
		method: "DELETE",
		headers: { Authorization: `Token ${token}` },
	});
	if (!res.ok) {
		throw new Error("Failed to unmark completion");
	}
}

export type ApiModuleView = {
	id: number;
	user: number;
	module: number;
	viewed_at: string;
};

export async function listModuleViews(token: string): Promise<ApiModuleView[]> {
	const res = await fetch(`${API_BASE_URL}/content-views/`, {
		headers: { Authorization: `Token ${token}` },
	});
	return handleResponse<ApiModuleView[]>(res);
}

export async function markModuleViewed(
	moduleId: number,
	token: string,
): Promise<ApiModuleView> {
	const res = await fetch(`${API_BASE_URL}/content-views/`, {
		method: "POST",
		headers: {
			Authorization: `Token ${token}`,
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ module: moduleId }),
	});
	return handleResponse<ApiModuleView>(res);
}

// ── Forum ──────────────────────────────────────────────────────────────────────

import type { ForumPost, ForumThread, ForumThreadDetail } from "@/types/forum";

function authHeader(token: string) {
	return {
		Authorization: `Token ${token}`,
		"Content-Type": "application/json",
	};
}

async function deleteRequest(url: string, token: string): Promise<void> {
	const res = await fetch(url, {
		method: "DELETE",
		headers: { Authorization: `Token ${token}` },
	});
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		const message =
			typeof data === "object" && data !== null
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

export async function getForumThread(
	id: number,
	token: string,
): Promise<ForumThreadDetail> {
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

export async function pinForumThread(
	id: number,
	is_pinned: boolean,
	token: string,
): Promise<ForumThread> {
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

export async function deleteForumThread(
	id: number,
	token: string,
): Promise<void> {
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

export async function deleteForumPost(
	id: number,
	token: string,
): Promise<void> {
	return deleteRequest(`${API_BASE_URL}/forum/posts/${id}/`, token);
}

export async function getProgramStatus(
	token: string,
): Promise<{ is_active: boolean }> {
	const res = await fetch(`${API_BASE_URL}/program-status/`, {
		headers: { Authorization: `Token ${token}` },
	});
	return handleResponse<{ is_active: boolean }>(res);
}

// ── Admin: Cohorts ─────────────────────────────────────────────────────────────

import type {
	Cohort,
	AdminModule,
	AdminContentItem,
	AdminUser,
	Enrollment,
	DashboardStats,
	AdditionalResourceCategory,
	AdminAdditionalResource,
} from "@/types/admin";

export async function listUsers(token: string): Promise<AdminUser[]> {
	const res = await fetch(`${API_BASE_URL}/users/`, {
		headers: { Authorization: `Token ${token}` },
	});
	return handleResponse<AdminUser[]>(res);
}

export async function updateUser(
	id: number,
	data: Partial<{ email: string; full_name: string; display_name: string; role: AdminUser["role"] }>,
	token: string,
): Promise<AdminUser> {
	const res = await fetch(`${API_BASE_URL}/users/${id}/`, {
		method: "PATCH",
		headers: authHeader(token),
		body: JSON.stringify(data),
	});
	return handleResponse<AdminUser>(res);
}

export async function deleteUser(id: number, token: string): Promise<void> {
	return deleteRequest(`${API_BASE_URL}/users/${id}/`, token);
}

export async function listCohorts(token: string): Promise<Cohort[]> {
	const res = await fetch(`${API_BASE_URL}/cohorts/`, {
		headers: { Authorization: `Token ${token}` },
	});
	return handleResponse<Cohort[]>(res);
}

export async function createCohort(
	data: { name: string; year: number; start_date: string; end_date: string },
	token: string,
): Promise<Cohort> {
	const res = await fetch(`${API_BASE_URL}/cohorts/`, {
		method: "POST",
		headers: authHeader(token),
		body: JSON.stringify(data),
	});
	return handleResponse<Cohort>(res);
}

export async function updateCohort(
	id: number,
	data: Partial<{
		name: string;
		year: number;
		start_date: string;
		end_date: string;
	}>,
	token: string,
): Promise<Cohort> {
	const res = await fetch(`${API_BASE_URL}/cohorts/${id}/`, {
		method: "PATCH",
		headers: authHeader(token),
		body: JSON.stringify(data),
	});
	return handleResponse<Cohort>(res);
}

export async function deleteCohort(id: number, token: string): Promise<void> {
	return deleteRequest(`${API_BASE_URL}/cohorts/${id}/`, token);
}

// ── Admin: Additional Resources (public Resources page) ─────────────────────────

export type AdditionalResourceInput = {
	category: AdditionalResourceCategory;
	title: string;
	author?: string;
	url?: string;
	display_order?: number;
	/** Omit entirely to leave the existing cover unchanged on update. */
	cover_image?: File | null;
};

function additionalResourceFormData(data: Partial<AdditionalResourceInput>): FormData {
	const form = new FormData();
	if (data.category !== undefined) form.append("category", data.category);
	if (data.title !== undefined) form.append("title", data.title);
	if (data.author !== undefined) form.append("author", data.author);
	if (data.url !== undefined) form.append("url", data.url);
	if (data.display_order !== undefined) form.append("display_order", String(data.display_order));
	if (data.cover_image) form.append("cover_image", data.cover_image);
	return form;
}

export async function listAdditionalResources(
	token: string,
	params?: { category?: AdditionalResourceCategory },
): Promise<AdminAdditionalResource[]> {
	const query = params?.category ? `?category=${params.category}` : "";
	const res = await fetch(`${API_BASE_URL}/additional-resources/${query}`, {
		headers: { Authorization: `Token ${token}` },
	});
	return handleResponse<AdminAdditionalResource[]>(res);
}

export async function createAdditionalResource(
	data: AdditionalResourceInput,
	token: string,
): Promise<AdminAdditionalResource> {
	const res = await fetch(`${API_BASE_URL}/additional-resources/`, {
		method: "POST",
		// No Content-Type here — the browser sets the multipart boundary for FormData.
		headers: { Authorization: `Token ${token}` },
		body: additionalResourceFormData(data),
	});
	return handleResponse<AdminAdditionalResource>(res);
}

export async function updateAdditionalResource(
	id: number,
	data: Partial<AdditionalResourceInput>,
	token: string,
): Promise<AdminAdditionalResource> {
	const res = await fetch(`${API_BASE_URL}/additional-resources/${id}/`, {
		method: "PATCH",
		headers: { Authorization: `Token ${token}` },
		body: additionalResourceFormData(data),
	});
	return handleResponse<AdminAdditionalResource>(res);
}

export async function deleteAdditionalResource(id: number, token: string): Promise<void> {
	return deleteRequest(`${API_BASE_URL}/additional-resources/${id}/`, token);
}

export async function listEnrollments(
	params: { cohort?: number; status?: Enrollment["status"] },
	token: string,
): Promise<Enrollment[]> {
	const search = new URLSearchParams();
	if (params.cohort) search.set("cohort", String(params.cohort));
	if (params.status) search.set("status", params.status);
	const query = search.toString() ? `?${search.toString()}` : "";
	const res = await fetch(`${API_BASE_URL}/enrollments/${query}`, {
		headers: { Authorization: `Token ${token}` },
	});
	return handleResponse<Enrollment[]>(res);
}

export async function createEnrollment(
	data: { user: number; cohort: number; status?: Enrollment["status"] },
	token: string,
): Promise<Enrollment> {
	const res = await fetch(`${API_BASE_URL}/enrollments/`, {
		method: "POST",
		headers: authHeader(token),
		body: JSON.stringify(data),
	});
	return handleResponse<Enrollment>(res);
}

export async function updateEnrollment(
	id: number,
	data: Partial<{ cohort: number; status: Enrollment["status"]; current_week: number }>,
	token: string,
): Promise<Enrollment> {
	const res = await fetch(`${API_BASE_URL}/enrollments/${id}/`, {
		method: "PATCH",
		headers: authHeader(token),
		body: JSON.stringify(data),
	});
	return handleResponse<Enrollment>(res);
}

export async function deleteEnrollment(id: number, token: string): Promise<void> {
	return deleteRequest(`${API_BASE_URL}/enrollments/${id}/`, token);
}

// ── Admin: Modules ─────────────────────────────────────────────────────────────

export async function listModulesAdmin(token: string): Promise<AdminModule[]> {
	const res = await fetch(`${API_BASE_URL}/modules/`, {
		headers: { Authorization: `Token ${token}` },
	});
	return handleResponse<AdminModule[]>(res);
}

export async function getModuleAdmin(
	id: number,
	token: string,
): Promise<AdminModule> {
	const res = await fetch(`${API_BASE_URL}/modules/${id}/`, {
		headers: { Authorization: `Token ${token}` },
	});
	return handleResponse<AdminModule>(res);
}

export async function createModule(
	data: {
		week_number: number;
		title: string;
		description?: string;
		is_published?: boolean;
	},
	token: string,
): Promise<AdminModule> {
	const res = await fetch(`${API_BASE_URL}/modules/`, {
		method: "POST",
		headers: authHeader(token),
		body: JSON.stringify(data),
	});
	return handleResponse<AdminModule>(res);
}

export async function updateModule(
	id: number,
	data: Partial<{
		week_number: number;
		title: string;
		description: string;
		summary: string;
		is_published: boolean;
	}>,
	token: string,
): Promise<AdminModule> {
	const res = await fetch(`${API_BASE_URL}/modules/${id}/`, {
		method: "PATCH",
		headers: authHeader(token),
		body: JSON.stringify(data),
	});
	return handleResponse<AdminModule>(res);
}

export async function deleteModule(id: number, token: string): Promise<void> {
	return deleteRequest(`${API_BASE_URL}/modules/${id}/`, token);
}

// ── Admin: Content Items ──────────────────────────────────────────────────────

export async function listContentItems(
	moduleId: number,
	token: string,
): Promise<AdminContentItem[]> {
	const res = await fetch(`${API_BASE_URL}/content-items/?module=${moduleId}`, {
		headers: { Authorization: `Token ${token}` },
	});
	return handleResponse<AdminContentItem[]>(res);
}

export async function createContentItem(
	data: Partial<AdminContentItem> & {
		module: number;
		title: string;
		type: string;
	},
	token: string,
): Promise<AdminContentItem> {
	const res = await fetch(`${API_BASE_URL}/content-items/`, {
		method: "POST",
		headers: authHeader(token),
		body: JSON.stringify(data),
	});
	return handleResponse<AdminContentItem>(res);
}

export async function updateContentItem(
	id: number,
	data: Partial<AdminContentItem>,
	token: string,
): Promise<AdminContentItem> {
	const res = await fetch(`${API_BASE_URL}/content-items/${id}/`, {
		method: "PATCH",
		headers: authHeader(token),
		body: JSON.stringify(data),
	});
	return handleResponse<AdminContentItem>(res);
}

export async function deleteContentItem(
	id: number,
	token: string,
): Promise<void> {
	return deleteRequest(`${API_BASE_URL}/content-items/${id}/`, token);
}

// ids: every content item in the module, in the new display order.
export async function reorderContentItems(moduleId: number, ids: number[], token: string): Promise<void> {
	const res = await fetch(`${API_BASE_URL}/content-items/reorder/`, {
		method: "POST",
		headers: authHeader(token),
		body: JSON.stringify({ module: moduleId, ids }),
	});
	if (!res.ok) {
		const data = await res.json().catch(() => ({}));
		const message =
			typeof data === "object" && data !== null
				? Object.values(data).flat().join(" ")
				: "Something went wrong";
		throw new Error(message || "Failed to reorder content items");
	}
}

// ── Admin: Dashboard ───────────────────────────────────────────────────────────

export async function getDashboardStats(
	token: string,
): Promise<DashboardStats> {
	const res = await fetch(`${API_BASE_URL}/dashboard/stats/`, {
		headers: { Authorization: `Token ${token}` },
	});
	return handleResponse<DashboardStats>(res);
}

export async function loginWithGoogle(
	credential: string,
): Promise<AuthResponse> {
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

export async function updateProfile(
	payload: { display_name: string },
	token: string,
) {
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
	token: string,
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

// ── Surveys ────────────────────────────────────────────────────────────────────

export type ApiSurvey = {
	id: number;
	code: string;
	title: string;
	type: string;
	module: number | null;
	is_unlocked: boolean;
	has_responded: boolean;
};

export type ApiSurveyDetail = ApiSurvey & {
	questions: Array<{
		id: string;
		type: string;
		text: string;
		min?: number;
		max?: number;
		unit?: string;
		section?: string;
		skip_if?: {
			question_id: string;
			value: number;
		};
	}>;
}

export async function listSurveys(token: string): Promise<ApiSurvey[]> {
	const res = await fetch(`${API_BASE_URL}/surveys/`, {
		headers: { Authorization: `Token ${token}` },
	});
	return handleResponse<ApiSurvey[]>(res);
}

export async function getSurvey(id: number | string, token: string): Promise<ApiSurveyDetail> {
  const res = await fetch(`${API_BASE_URL}/surveys/${id}/`, {
    headers: { Authorization: `Token ${token}` },
  });
  return handleResponse<ApiSurveyDetail>(res);
}

export async function submitSurveyResponse(
  payload: { survey: number; answers: Record<string, number | string> },
  token: string,
): Promise<{ id: number; survey: number; answers: Record<string, number | string>; submitted_at: string }> {
  const res = await fetch(`${API_BASE_URL}/survey-responses/`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Token ${token}`,
    },
    body: JSON.stringify(payload),
  });
  return handleResponse(res);
}
