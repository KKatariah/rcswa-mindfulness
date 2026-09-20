import { useCallback, useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { programmeRequest, type ProgrammeModule, type Completion } from "@/lib/programme";

export function useProgramme() {
  const { user, isLoading: authLoading } = useAuth();
  const [data, setData] = useState<{ modules: ProgrammeModule[]; completions: Completion[]; userId: number } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const reload = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    if (!user || authLoading) return;
    const controller = new AbortController();
    async function load() {
      setLoading(true);
      setError(null);
      try {
        const [modules, completions] = await Promise.all([
          programmeRequest<ProgrammeModule[]>("/modules/", { signal: controller.signal }),
          programmeRequest<Completion[]>("/progress/", { signal: controller.signal }),
        ]);
        if (!controller.signal.aborted) setData({ modules: modules.sort((a, b) => a.week_number - b.week_number), completions, userId: user!.id });
      } catch (err) {
        if (!controller.signal.aborted) setError(err instanceof Error ? err.message : "Unable to load your programme.");
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }
    void load();
    window.addEventListener("focus", reload);
    return () => { controller.abort(); window.removeEventListener("focus", reload); };
  }, [user, authLoading, revision, reload]);

  const ownData = data?.userId === user?.id ? data : null;
  return { user, authLoading, loading: authLoading || (!!user && (loading || (!ownData && !error))), error, modules: ownData?.modules ?? [], completions: ownData?.completions ?? [], reload };
}
