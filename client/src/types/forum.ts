export type ForumPost = {
  id: number;
  thread: number;
  parent_post: number | null;
  author_name: string;
  author_avatar_url?: string | null;
  body: string;
  created_at: string;
  updated_at: string;
  edited_at?: string | null;
  can_edit: boolean;
  // The viewer wrote it (can_edit is also true for admins).
  is_own: boolean;
  // Written by whoever started the thread.
  is_thread_author: boolean;
  // The viewer has reported it and a moderator hasn't dealt with that report yet.
  has_flagged: boolean;
};

export type ForumThread = {
  id: number;
  title: string;
  module: number | null;
  content_item: number | null;
  author_name: string;
  author_avatar_url?: string | null;
  created_at: string;
  updated_at: string;
  edited_at?: string | null;
  body: string;
  reply_count: number;
  can_edit: boolean;
  is_own: boolean;
  is_pinned: boolean;
  // Position among pinned threads (1 = top); 0 when not pinned.
  pin_order: number;
  can_pin: boolean;
  // The thread's cohort has ended, so it can be read but not replied to.
  is_archived: boolean;
  // Which cohort the thread belongs to, e.g. "Spring (2026)". Admins only; null for students.
  cohort_name: string | null;
};

export type ForumThreadDetail = ForumThread & {
  opening_post: ForumPost | null;
  replies: ForumPost[];
};

export type ForumRule = { title: string; body: string };

/** The current version of the forum rules. Each save by an admin makes a new version (new id). */
export type ForumRules = {
  id: number;
  rules: ForumRule[];
  created_at: string;
  // Who saved this version; only sent to admins.
  updated_by_name: string | null;
};
