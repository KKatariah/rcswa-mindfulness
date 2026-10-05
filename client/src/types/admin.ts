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
	summary: string;
	is_published: boolean;
	is_unlocked: boolean;
	content_items: AdminContentItem[];
};

export type ModuleProgressStatus = "completed" | "in_progress" | "not_started" | "locked";

export type ModuleStudentProgress = {
	user_id: number;
	full_name: string;
	email: string;
	cohort_id: number;
	cohort_name: string;
	// When this module opened for the student's cohort (YYYY-MM-DD).
	unlock_date: string;
	status: ModuleProgressStatus;
	completed_item_ids: number[];
	viewed: boolean;
	// null when the module has no weekly survey.
	survey_submitted: boolean | null;
	last_activity: string | null;
};

export type ModuleProgress = {
	item_count: number;
	survey: { id: number; title: string } | null;
	students: ModuleStudentProgress[];
};

export type UserOverview = {
	user: AdminUser & { avatar_url: string; forum_rules_accepted_at: string | null };
	// Newest first.
	enrollments: {
		id: number;
		cohort_id: number;
		cohort_name: string;
		cohort_start_date: string;
		cohort_end_date: string;
		status: Enrollment["status"];
		enrolled_at: string;
	}[];
	// Published modules, by week.
	modules: {
		id: number;
		week_number: number;
		title: string;
		item_count: number;
		completed_count: number;
		status: ModuleProgressStatus;
		// null when the person has no active cohort.
		unlock_date: string | null;
		survey_submitted: boolean | null;
		last_activity: string | null;
	}[];
	surveys: {
		id: number;
		title: string;
		type: SurveyType;
		week_number: number | null;
		submitted_at: string | null;
	}[];
	forum: {
		thread_count: number;
		post_count: number;
		recent_posts: { id: number; thread_title: string; body: string; is_head_post: boolean; created_at: string }[];
	};
	notifications: {
		push_devices: number;
		email_enabled: boolean;
		push_denied: boolean;
		reminder_time: string;
		daily_content_reminder: boolean;
		daily_survey_reminder: boolean;
	};
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

export type SurveyType = "intake" | "weekly" | "end" | "followup";

export type SurveyQuestion = {
	id: string;
	type: "integer" | "likert" | "longtext";
	text: string;
	section?: string;
	unit?: string;
	min?: number;
	max?: number;
	scale_labels?: Record<string, string>;
	skip_if?: { question_id: string; value: number };
};

export type AdminSurvey = {
	id: number;
	code: string;
	title: string;
	type: SurveyType;
	module: number | null;
	questions: SurveyQuestion[];
	response_count: number;
};

export type AdminSurveyResponse = {
	id: number;
	participant_id: number;
	full_name: string;
	email: string;
	cohort: string;
	submitted_at: string;
	answers: Record<string, number | string>;
};
