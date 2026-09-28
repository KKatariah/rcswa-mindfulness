export type ForumPost = {
  id: number;
  thread: number;
  parent_post: number | null;
  author_name: string;
  author_email?: string | null;
  author_avatar_url?: string | null;
  body: string;
  created_at: string;
  updated_at: string;
  can_edit: boolean;
};

export type ForumThread = {
  id: number;
  title: string;
  module: number | null;
  content_item: number | null;
  author_name: string;
  author_email?: string | null;
  author_avatar_url?: string | null;
  created_at: string;
  updated_at: string;
  body: string;
  reply_count: number;
  can_edit: boolean;
  is_pinned: boolean;
  can_pin: boolean;
};

export type ForumThreadDetail = ForumThread & {
  opening_post: ForumPost | null;
  replies: ForumPost[];
};
