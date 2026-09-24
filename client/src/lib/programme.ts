import { API_BASE_URL } from "@/lib/api";

export type ProgrammeModule = {
  id: number;
  unlock_at: string | null;
  is_unlocked: boolean;
  week_number: number;
  title: string;
  description: string;
  content_items: { id: number; title: string; type: "video" | "audio"; embed_url: string }[];
  resources: { id: number; title: string; url: string }[];
};
export type Completion = { id: number; content_item: number };

export async function programmeRequest<T>(path: string, options: RequestInit = {}): Promise<T> {
  const token = localStorage.getItem("token");
  if (!token) throw new Error("Programme data is currently unavailable.");
  const response = await fetch(`${API_BASE_URL}${path}`, {
    ...options,
    headers: { "Content-Type": "application/json", Authorization: `Token ${token}`, ...options.headers },
  });
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) throw new Error("Programme data is currently unavailable.");
    throw new Error(`Unable to load or save your progress (${response.status}). Please try again.`);
  }
  return response.json() as Promise<T>;
}

export function moduleProgress(module: ProgrammeModule, completions: Completion[]) {
  const ids = new Set(completions.map((completion) => completion.content_item));
  const total = module.content_items.length;
  const done = module.content_items.filter((item) => ids.has(item.id)).length;
  return { complete: total > 0 && done === total, percentage: total ? Math.round(done / total * 100) : 0 };
}
