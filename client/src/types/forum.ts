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
};

export type ForumThreadDetail = ForumThread & {
  opening_post: ForumPost | null;
  replies: ForumPost[];
};
