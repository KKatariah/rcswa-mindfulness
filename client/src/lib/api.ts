import type { AuthUser } from "@/types/user";
import type { ForumPost, ForumThread, ForumThreadDetail } from "@/types/forum";
import type {
	Cohort,
	AdminModule,
	AdminContentItem,
	AdminUser,
	Enrollment,
	DashboardStats,
	AdditionalResourceCategory,
	AdminAdditionalResource,
	AdminSurvey,
	AdminSurveyResponse,
} from "@/types/admin";

export const API_BASE_URL =
	process.env.NEXT_PUBLIC_API_BASE_URL ?? "http://127.0.0.1:8000/api";

/** The signed-in user's API token, or null when signed out (or rendering on the server). */
export function getToken(): string | null {
	return typeof window === "undefined" ? null : localStorage.getItem("token");
}

// ── Request helpers ────────────────────────────────────────────────────────────

type RequestOptions = {
	method?: "GET" | "POST" | "PATCH" | "DELETE";
	/** Sent as JSON, or as-is for FormData (the browser then sets the multipart boundary). */
	body?: unknown;
	/**
	 * Public endpoints pass false so no token is sent: the API rejects a stale token
	 * even on endpoints that don't need one, which would break login and the home page.
	 */
	auth?: boolean;
};

function send(path: string, { method = "GET", body, auth = true }: RequestOptions = {}): Promise<Response> {
	const headers: Record<string, string> = {};
	const token = auth ? getToken() : null;
	if (token) headers.Authorization = `Token ${token}`;

	let payload: BodyInit | undefined;
	if (body instanceof FormData) {
		payload = body;
	} else if (body !== undefined) {
		headers["Content-Type"] = "application/json";
		payload = JSON.stringify(body);
	}
	return fetch(`${API_BASE_URL}${path}`, { method, headers, body: payload });
}

/** Turns a failed response into a thrown Error with a message fit to show the user. */
async function throwForStatus(res: Response): Promise<never> {
	// Error bodies are normally JSON, but a proxy or server crash can return HTML.
	const data: unknown = await res.json().catch(() => null);
	const detail = typeof data === "object" && data !== null ? (data as { detail?: unknown }).detail : undefined;

	// The stored token was rejected (e.g. the password was changed in another
	// tab). Sign out and go home rather than leaving the page half-broken.
	// Login itself also returns 401, but with "error" rather than "detail".
	if (res.status === 401 && detail && getToken()) {
		localStorage.removeItem("token");
		localStorage.removeItem("user");
		if (window.location.pathname !== "/") {
			// eslint-disable-next-line @next/next/no-location-assign-relative-destination -- a full reload resets AuthContext; this runs outside React so there's no router
			window.location.assign("/");
		}
		throw new Error("Your session has expired. Please log in again.");
	}
	if (res.status === 429) {
		const seconds = /(\d+) seconds?/.exec(String(detail ?? ""))?.[1];
		throw new Error(
			seconds
				? `You're doing that too often. Please wait ${seconds} seconds and try again.`
				: "You're doing that too often. Please wait a moment and try again.",
		);
	}
	const message = typeof data === "object" && data !== null ? Object.values(data).flat().join(" ") : "";
	throw new Error(message || "Something went wrong");
}

async function request<T>(path: string, options?: RequestOptions): Promise<T> {
	const res = await send(path, options);
	if (!res.ok) return throwForStatus(res);
	// 204 No Content (deletes, reorders) has no body to parse.
	if (res.status === 204) return undefined as T;
	return res.json() as Promise<T>;
}

function query(params: Record<string, string | number | undefined>): string {
	const search = new URLSearchParams();
	for (const [key, value] of Object.entries(params)) {
		if (value !== undefined && value !== "") search.set(key, String(value));
	}
	const text = search.toString();
	return text ? `?${text}` : "";
}

// ── Auth & profile ─────────────────────────────────────────────────────────────

type AuthResponse = { message: string; token: string; user: AuthUser };

export async function loginUser(payload: { email: string; password: string }): Promise<AuthResponse> {
	const data = await request<AuthResponse>("/login/", { method: "POST", body: payload, auth: false });
	localStorage.setItem("token", data.token);
	return data;
}

export async function loginWithGoogle(credential: string): Promise<AuthResponse> {
	const data = await request<AuthResponse>("/google-login/", { method: "POST", body: { credential }, auth: false });
	localStorage.setItem("token", data.token);
	return data;
}

export function registerUser(payload: {
	email: string;
	full_name: string;
	password: string;
}): Promise<{ message: string; user: AuthUser }> {
	return request("/register/", { method: "POST", body: payload, auth: false });
}

export async function logoutUser(): Promise<void> {
	// Best effort: the token is dropped locally even if the server call fails.
	await send("/logout/", { method: "POST" }).catch(() => undefined);
	localStorage.removeItem("token");
}

export function getCurrentUser(): Promise<{ user: AuthUser }> {
	if (!getToken()) return Promise.reject(new Error("No token"));
	return request("/user/");
}

export function updateProfile(payload: { display_name: string }): Promise<{ message: string; user: AuthUser }> {
	return request("/profile/", { method: "PATCH", body: payload });
}

/** Changing the password replaces the API token; the new one is stored here. */
export async function changePassword(payload: {
	current_password: string;
	new_password: string;
}): Promise<{ message: string; token: string }> {
	const data = await request<{ message: string; token: string }>("/change-password/", { method: "POST", body: payload });
	localStorage.setItem("token", data.token);
	return data;
}

// ── Modules & progress ─────────────────────────────────────────────────────────

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

export type ApiModuleSummary = { id: number; week_number: number; title: string; summary: string };

export type ApiContentCompletion = {
	id: number;
	user: number;
	content_item: number;
	completed_at: string;
};

export type ApiModuleView = {
	id: number;
	user: number;
	module: number;
	viewed_at: string;
};

export function listModules(): Promise<ApiModule[]> {
	return request("/modules/");
}

export function getModule(id: number | string): Promise<ApiModuleDetail> {
	return request(`/modules/${id}/`);
}

/** Public programme overview for the home page. */
export function listModuleSummaries(): Promise<ApiModuleSummary[]> {
	return request("/modules/summary/", { auth: false });
}

export function listProgress(): Promise<ApiContentCompletion[]> {
	return request("/progress/");
}

export function markContentComplete(contentItemId: number): Promise<ApiContentCompletion> {
	return request("/progress/", { method: "POST", body: { content_item: contentItemId } });
}

export function deleteContentCompletion(completionId: number): Promise<void> {
	return request(`/progress/${completionId}/`, { method: "DELETE" });
}

export function listModuleViews(): Promise<ApiModuleView[]> {
	return request("/content-views/");
}

export function markModuleViewed(moduleId: number): Promise<ApiModuleView> {
	return request("/content-views/", { method: "POST", body: { module: moduleId } });
}

// ── Forum ──────────────────────────────────────────────────────────────────────

export function listForumThreads(): Promise<ForumThread[]> {
	return request("/forum/threads/");
}

export function getForumThread(id: number): Promise<ForumThreadDetail> {
	return request(`/forum/threads/${id}/`);
}

export function createForumThread(data: { body: string; module?: number; content_item?: number }): Promise<ForumThread> {
	return request("/forum/threads/", { method: "POST", body: data });
}

export function pinForumThread(id: number, is_pinned: boolean): Promise<ForumThread> {
	return request(`/forum/threads/${id}/`, { method: "PATCH", body: { is_pinned } });
}

export function deleteForumThread(id: number): Promise<void> {
	return request(`/forum/threads/${id}/`, { method: "DELETE" });
}

export function createForumPost(data: { thread: number; body: string; parent_post?: number }): Promise<ForumPost> {
	return request("/forum/posts/", { method: "POST", body: data });
}

export function updateForumPost(id: number, data: { body: string }): Promise<ForumPost> {
	return request(`/forum/posts/${id}/`, { method: "PATCH", body: data });
}

export function deleteForumPost(id: number): Promise<void> {
	return request(`/forum/posts/${id}/`, { method: "DELETE" });
}

export function getProgramStatus(): Promise<{ is_active: boolean }> {
	return request("/program-status/");
}

// ── Admin: users, cohorts & enrollments ────────────────────────────────────────

export function listUsers(): Promise<AdminUser[]> {
	return request("/users/");
}

export function updateUser(
	id: number,
	data: Partial<{ email: string; full_name: string; display_name: string; role: AdminUser["role"] }>,
): Promise<AdminUser> {
	return request(`/users/${id}/`, { method: "PATCH", body: data });
}

export function deleteUser(id: number): Promise<void> {
	return request(`/users/${id}/`, { method: "DELETE" });
}

type CohortInput = { name: string; year: number; start_date: string; end_date: string };

export function listCohorts(): Promise<Cohort[]> {
	return request("/cohorts/");
}

export function createCohort(data: CohortInput): Promise<Cohort> {
	return request("/cohorts/", { method: "POST", body: data });
}

export function updateCohort(id: number, data: Partial<CohortInput>): Promise<Cohort> {
	return request(`/cohorts/${id}/`, { method: "PATCH", body: data });
}

export function deleteCohort(id: number): Promise<void> {
	return request(`/cohorts/${id}/`, { method: "DELETE" });
}

export function listEnrollments(params: { cohort?: number; status?: Enrollment["status"] } = {}): Promise<Enrollment[]> {
	return request(`/enrollments/${query(params)}`);
}

export function createEnrollment(data: { user: number; cohort: number; status?: Enrollment["status"] }): Promise<Enrollment> {
	return request("/enrollments/", { method: "POST", body: data });
}

export function updateEnrollment(
	id: number,
	data: Partial<{ cohort: number; status: Enrollment["status"] }>,
): Promise<Enrollment> {
	return request(`/enrollments/${id}/`, { method: "PATCH", body: data });
}

export function deleteEnrollment(id: number): Promise<void> {
	return request(`/enrollments/${id}/`, { method: "DELETE" });
}

// ── Admin: Additional Resources (public Resources page) ─────────────────────────

export type AdditionalResourceInput = {
	category: AdditionalResourceCategory;
	title: string;
	author?: string;
	url?: string;
	/** Omit entirely to leave the existing cover unchanged on update. */
	cover_image?: File | null;
};

function additionalResourceFormData(data: Partial<AdditionalResourceInput>): FormData {
	const form = new FormData();
	if (data.category !== undefined) form.append("category", data.category);
	if (data.title !== undefined) form.append("title", data.title);
	if (data.author !== undefined) form.append("author", data.author);
	if (data.url !== undefined) form.append("url", data.url);
	if (data.cover_image) form.append("cover_image", data.cover_image);
	return form;
}

export function listAdditionalResources(params: { category?: AdditionalResourceCategory } = {}): Promise<AdminAdditionalResource[]> {
	return request(`/additional-resources/${query(params)}`);
}

export function createAdditionalResource(data: AdditionalResourceInput): Promise<AdminAdditionalResource> {
	return request("/additional-resources/", { method: "POST", body: additionalResourceFormData(data) });
}

export function updateAdditionalResource(id: number, data: Partial<AdditionalResourceInput>): Promise<AdminAdditionalResource> {
	return request(`/additional-resources/${id}/`, { method: "PATCH", body: additionalResourceFormData(data) });
}

export function deleteAdditionalResource(id: number): Promise<void> {
	return request(`/additional-resources/${id}/`, { method: "DELETE" });
}

// ids: every resource in the category, in the new display order.
export function reorderAdditionalResources(category: AdditionalResourceCategory, ids: number[]): Promise<void> {
	return request("/additional-resources/reorder/", { method: "POST", body: { category, ids } });
}

// ── Admin: modules & content items ─────────────────────────────────────────────

type ModuleInput = { week_number: number; title: string; description: string; summary: string; is_published: boolean };

export function listModulesAdmin(): Promise<AdminModule[]> {
	return request("/modules/");
}

export function getModuleAdmin(id: number): Promise<AdminModule> {
	return request(`/modules/${id}/`);
}

export function createModule(
	data: Pick<ModuleInput, "week_number" | "title"> & Partial<Pick<ModuleInput, "description" | "is_published">>,
): Promise<AdminModule> {
	return request("/modules/", { method: "POST", body: data });
}

export function updateModule(id: number, data: Partial<ModuleInput>): Promise<AdminModule> {
	return request(`/modules/${id}/`, { method: "PATCH", body: data });
}

export function deleteModule(id: number): Promise<void> {
	return request(`/modules/${id}/`, { method: "DELETE" });
}

// ids: every module, in the new week order. The server reassigns the existing week numbers.
export function reorderModules(ids: number[]): Promise<void> {
	return request("/modules/reorder/", { method: "POST", body: { ids } });
}

export function createContentItem(
	data: Partial<AdminContentItem> & { module: number; title: string; type: string },
): Promise<AdminContentItem> {
	return request("/content-items/", { method: "POST", body: data });
}

export function updateContentItem(id: number, data: Partial<AdminContentItem>): Promise<AdminContentItem> {
	return request(`/content-items/${id}/`, { method: "PATCH", body: data });
}

export function deleteContentItem(id: number): Promise<void> {
	return request(`/content-items/${id}/`, { method: "DELETE" });
}

// ids: every content item in the module, in the new display order.
export function reorderContentItems(moduleId: number, ids: number[]): Promise<void> {
	return request("/content-items/reorder/", { method: "POST", body: { module: moduleId, ids } });
}

// ── Admin: dashboard & surveys ─────────────────────────────────────────────────

export function getDashboardStats(): Promise<DashboardStats> {
	return request("/dashboard/stats/");
}

type SurveyInput = Omit<AdminSurvey, "id" | "response_count">;

export function listSurveysAdmin(): Promise<AdminSurvey[]> {
	return request("/surveys/manage/");
}

export function getSurveyAdmin(id: number): Promise<Omit<AdminSurvey, "response_count">> {
	return request(`/surveys/${id}/`);
}

export function createSurvey(data: SurveyInput): Promise<AdminSurvey> {
	return request("/surveys/", { method: "POST", body: data });
}

export function updateSurvey(id: number, data: Partial<SurveyInput>): Promise<AdminSurvey> {
	return request(`/surveys/${id}/`, { method: "PATCH", body: data });
}

export function deleteSurvey(id: number): Promise<void> {
	return request(`/surveys/${id}/`, { method: "DELETE" });
}

export function listSurveyResponses(id: number): Promise<AdminSurveyResponse[]> {
	return request(`/surveys/${id}/responses/`);
}

/** Download survey responses as CSV (admin only). Omit surveyId for all surveys. */
export async function downloadSurveyResponsesCsv(
	options: { surveyId?: number; includeIdentity?: boolean } = {},
): Promise<void> {
	const res = await send(
		`/surveys/export/${query({ survey: options.surveyId, identify: options.includeIdentity ? 1 : undefined })}`,
	);
	if (!res.ok) await throwForStatus(res);

	const filename =
		/filename="([^"]+)"/.exec(res.headers.get("Content-Disposition") ?? "")?.[1] ?? "survey-responses.csv";
	const url = URL.createObjectURL(await res.blob());
	const link = document.createElement("a");
	link.href = url;
	link.download = filename;
	link.click();
	URL.revokeObjectURL(url);
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
};

export function listSurveys(): Promise<ApiSurvey[]> {
	return request("/surveys/");
}

export function getSurvey(id: number | string): Promise<ApiSurveyDetail> {
	return request(`/surveys/${id}/`);
}

export function submitSurveyResponse(payload: {
	survey: number;
	answers: Record<string, number | string>;
}): Promise<{ id: number; survey: number; answers: Record<string, number | string>; submitted_at: string }> {
	return request("/survey-responses/", { method: "POST", body: payload });
}

// ── Notifications ──────────────────────────────────────────────────────────────

export type NotificationPreferences = {
	id: number;
	email_enabled: boolean;
	inapp_enabled: boolean;
	reminder_time: string;
	push_denied: boolean;
	daily_content_reminder: boolean;
	survey_unlocked_reminder: boolean;
	daily_survey_reminder: boolean;
};

export function getNotificationPreferences(): Promise<NotificationPreferences> {
	return request("/notifications/preferences/me/");
}

export function updateNotificationPreferences(preferences: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
	return request("/notifications/preferences/me/", { method: "PATCH", body: preferences });
}

export async function getVapidPublicKey(): Promise<string | undefined> {
	const data = await request<{ vapid_public_key?: string }>("/notifications/vapid-public-key/", { auth: false });
	return data.vapid_public_key;
}

export function savePushSubscription(subscription: { endpoint: string; p256dh: string; auth: string }): Promise<unknown> {
	return request("/notifications/subscriptions/", { method: "POST", body: subscription });
}
