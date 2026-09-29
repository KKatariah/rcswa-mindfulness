export type Cohort = {
	id: number;
	name: string;
	year: number;
	start_date: string;
	end_date: string;
};

export type AdminContentItem = {
	id: number;
	module: number;
	title: string;
	type: "video" | "audio";
	provider: "youtube" | "soundcloud" | "";
	embed_url: string;
	display_order: number;
};

export type AdminModule = {
	id: number;
	week_number: number;
	title: string;
	description: string;
	is_published: boolean;
	is_unlocked: boolean;
	content_items: AdminContentItem[];
	resources: unknown[];
};

export type AdminUser = {
	id: number;
	email: string;
	full_name: string;
	display_name: string;
	role: "student" | "admin";
	auth_provider: string;
	is_staff: boolean;
	created_at: string;
};

export type Enrollment = {
	id: number;
	user: number;
	user_email: string;
	user_full_name: string;
	cohort: number;
	current_week: number;
	status: "pending" | "active" | "completed" | "withdrawn";
	enrolled_at: string;
};

export type AdditionalResourceCategory = "book" | "documentary" | "online_program";

export type AdminAdditionalResource = {
	id: number;
	category: AdditionalResourceCategory;
	title: string;
	author: string;
	url: string;
	cover_image: string | null;
	display_order: number;
	created_at: string;
	updated_at: string;
};

export type DashboardStats = {
	total_enrolled: number;
	by_cohort: {
		cohort_id: number;
		cohort_name: string;
		enrolled: number;
		pending: number;
		active: number;
		completed: number;
		withdrawn: number;
	}[];
	modules: {
		id: number;
		week_number: number;
		title: string;
		completed_count: number;
		eligible_count: number;
		completion_pct: number;
	}[];
	survey_response_rates: {
		survey_id: number;
		code: string;
		title: string;
		response_count: number;
		eligible_count: number;
		response_pct: number;
	}[];
	forum_activity: {
		thread_count: number;
		post_count: number;
		active_participants: number;
	};
	enrollment_status_breakdown: Record<string, number>;
};
