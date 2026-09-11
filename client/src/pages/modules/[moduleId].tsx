import { useState } from "react";
import Head from "next/head";
import Link from "next/link";
import { useRouter } from "next/router";
import { useProgramme } from "@/hooks/useProgramme";
import { programmeRequest, type Completion } from "@/lib/programme";
import ContentEmbed from "@/components/modules/ContentEmbed";
import Sidebar from "@/components/main/Sidebar";

export default function ModulePage() {
  const router = useRouter();
  const { user, loading, error, modules, completions, reload } = useProgramme();
  const [saving, setSaving] = useState<number | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const selectedModule = modules.find((item) => String(item.id) === router.query.moduleId);

  async function complete(itemId: number) {
    if (saving !== null) return;
    setSaving(itemId);
    setSaveError(null);
    try {
      await programmeRequest<Completion>("/progress/", { method: "POST", body: JSON.stringify({ content_item: itemId }) });
      reload();
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : "Unable to save completion.");
    } finally { setSaving(null); }
  }

  const message = !router.isReady || loading ? "Loading module…"
    : error || (!selectedModule ? "This module is not available."
    : !selectedModule.is_unlocked ? `This module unlocks ${selectedModule.unlock_at ? new Date(selectedModule.unlock_at).toLocaleString() : "soon"}.` : null);
  if (message || !selectedModule) {
    return (
      <div className="min-h-screen bg-surface-muted p-6">
        <div className="mx-auto max-w-3xl rounded-xl bg-white p-6">
          <Link href="/progress" className="text-brand-blue-dark underline">Back to progress</Link>
          <p role="status" className="mt-4">{message}</p>
          {!loading && <button onClick={reload} className="mt-4 text-brand-blue-dark underline">Refresh</button>}
        </div>
      </div>
    );
  }

  return (
    <>
      <Head><title>{selectedModule.title} | Wellbeing Course</title></Head>
      <div className="min-h-screen bg-cover bg-center bg-fixed p-4 md:p-6" style={{ backgroundImage: "url(/images/module-background.jpg)" }}>
        <div className="mx-auto grid max-w-[1600px] items-start gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
          <div className="hidden md:sticky md:top-6 md:block"><Sidebar responsive username={user?.full_name || user?.email || "Username"} /></div>
          <article className="min-w-0 rounded-xl bg-white p-6 sm:p-10">
            <Link href="/progress" className="text-sm text-brand-blue-dark underline">← Back to your progress</Link>
            <p className="mt-6 text-sm text-muted">Week {selectedModule.week_number}</p>
            <h1 className="mt-2 text-3xl font-extrabold text-ink">{selectedModule.title}</h1>
            <p className="mt-4 whitespace-pre-wrap text-ink-soft">{selectedModule.description}</p>
            <hr className="my-8 border-gray-200" />
            {saveError && <p role="alert" className="mb-4 text-red-700">{saveError}</p>}
            {!selectedModule.content_items.length && <p className="text-muted">Activities will appear here when they are added.</p>}
            {selectedModule.content_items.map((item) => {
              const done = completions.some((completion) => completion.content_item === item.id);
              return (
                <section key={item.id} className="mb-8 border-b border-gray-200 pb-6 last:border-0">
                  <h2 className="text-lg font-bold">{item.title}</h2>
                  <ContentEmbed type={item.type} title={item.title} embedUrl={item.embed_url} />
                  <button type="button" disabled={done || saving !== null} onClick={() => void complete(item.id)} className="rounded-lg bg-brand-blue-dark px-4 py-3 text-sm font-semibold text-white disabled:opacity-60">
                    {done ? "Completed ✓" : saving === item.id ? "Saving…" : "Mark as complete"}
                  </button>
                </section>
              );
            })}
            {!!selectedModule.resources.length && <section><h2 className="font-bold">Resources</h2><ul className="mt-3 space-y-2">{selectedModule.resources.map((resource) => <li key={resource.id}><a className="text-brand-blue-dark underline" href={resource.url} target="_blank" rel="noopener noreferrer">{resource.title}</a></li>)}</ul></section>}
          </article>
        </div>
      </div>
    </>
  );
}
