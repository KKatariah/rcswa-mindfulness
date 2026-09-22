import { useProgramme } from "@/hooks/useProgramme";
import { moduleProgress } from "@/lib/programme";
import Head from "next/head";
import Link from "next/link";
import Sidebar from "@/components/main/Sidebar";
import NextSession from "@/components/modules/NextSession";
import {
  HomeIcon, BookOpenIcon, BarChart2Icon, MessageCircleIcon,
  FolderIcon, CheckIcon, PlayIcon, LockIcon,
} from "@/components/ui/icons";

const navigation = [
  { label: "Home", href: "/", icon: HomeIcon },
  { label: "Modules", href: "/modules", icon: BookOpenIcon },
  { label: "Progress", href: "/progress", icon: BarChart2Icon },
  { label: "Forum", href: "/forum", icon: MessageCircleIcon },
  { label: "Resources", href: "/resources", icon: FolderIcon },
];

export default function ProgressPage() {
  const { user, loading, error, modules, completions, reload } = useProgramme();
  if (loading || error || !modules.length) {
    return (
      <div className="min-h-screen bg-surface-muted p-6">
        <div className="mx-auto max-w-3xl rounded-xl bg-white p-6">
          <h1 className="text-2xl font-bold">Your Progress</h1>
          <p className="mt-4" role="status">{loading ? "Loading your progress…" : error || "No modules are available to display."}</p>
          {!loading && <button onClick={reload} className="mt-4 text-brand-blue-dark underline">Refresh</button>}
        </div>
      </div>
    );
  }
  const weeks = modules.map((module) => {
    const progress = moduleProgress(module, completions);
    return { id: module.id, number: module.week_number, title: module.title, status: !module.is_unlocked ? "locked" : progress.complete ? "completed" : "current", progress: progress.percentage, unlockAt: module.unlock_at };
  });
  const next = weeks.find((week) => week.status === "current");
  const completed = weeks.filter((week) => week.status === "completed").length;
  const percentage = Math.round((completed / weeks.length) * 100);

  return (
    <>
      <Head>
        <title>Your Progress | Wellbeing Course</title>
        <meta name="description" content="Track your progress through the eight-week mindfulness programme." />
      </Head>
      <div
        className="min-h-dvh bg-cover bg-center bg-fixed px-4 pb-28 pt-4 md:p-6"
        style={{ backgroundImage: "url(/images/module-background.jpg)" }}
      >
        <div className="mx-auto grid max-w-[1920px] items-start gap-4 md:grid-cols-[240px_minmax(0,1fr)] md:gap-6 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
          <div className="hidden md:sticky md:top-6 md:block">
            <Sidebar responsive />
          </div>

          <div className="min-w-0 space-y-4">
            <header className="px-1 pb-2 text-white md:rounded-[10px] md:border md:border-gray-200 md:bg-white md:p-6 md:text-ink">
              <div className="mb-6 flex items-center gap-2 text-xs md:hidden">
                <span className="flex size-7 items-center justify-center rounded-full bg-white text-muted" aria-hidden="true">U</span>
                <span>{user?.full_name || user?.email || "Username"}</span>
              </div>
              <h1 className="text-2xl font-extrabold sm:text-3xl">Your Progress</h1>
              <p className="mt-2 text-sm md:text-muted">Track your meditation journey</p>
            </header>

            <section aria-label="Overall progress" className="flex items-center gap-5 rounded-[10px] border border-gray-200 bg-white p-5 sm:gap-6 sm:p-6">
              <div
                role="progressbar"
                aria-label="Programme completion"
                aria-valuemin={0}
                aria-valuemax={100}
                aria-valuenow={percentage}
                aria-valuetext={`${completed} of ${weeks.length} weeks completed`}
                className="relative flex size-24 shrink-0 items-center justify-center rounded-full sm:size-28"
                style={{ background: `conic-gradient(#5096cf ${percentage}%, #e5e7eb 0)` }}
              >
                <div className="flex size-[76px] flex-col items-center justify-center rounded-full bg-white sm:size-[90px]">
                  <span className="text-xs text-muted">Overall</span>
                  <span className="text-xl font-extrabold text-ink sm:text-2xl">{percentage}%</span>
                </div>
              </div>
              <div className="min-w-0">
                <h2 className="text-sm font-bold text-ink sm:text-base">Overall Progress</h2>
                <p className="mt-1 text-xs font-semibold text-ink sm:text-sm">{completed} of {weeks.length} Weeks Completed</p>
                <p className="mt-2 text-xs text-muted">{completed === weeks.length ? "Programme complete. Well done!" : "Your progress is saved as you complete each activity."}</p>
              </div>
            </section>

            <section aria-label="Weekly progress" className="overflow-hidden rounded-[10px] border border-gray-200 bg-white">
              <ol className="divide-y divide-gray-200">
                {weeks.map((week) => {
                  const locked = week.status === "locked";
                  const Icon = locked ? LockIcon : week.status === "completed" ? CheckIcon : PlayIcon;
                  const content = (
                    <>
                      <span className={`flex size-7 shrink-0 items-center justify-center rounded-full ${week.status === "completed" ? "bg-brand-blue text-white" : locked ? "bg-surface-muted text-muted" : "bg-surface-muted text-brand-blue-dark"}`}>
                        <Icon className="size-4" aria-hidden="true" />
                      </span>
                      <span className="text-sm font-semibold">Week {week.number}<span className="sr-only">: {week.title}</span></span>
                      <span className="sr-only">{locked ? ", locked" : week.status === "completed" ? ", completed" : ", in progress"}</span>
                      {!locked && (
                        <span className="ml-auto h-1.5 w-24 overflow-hidden rounded-full bg-gray-200 sm:w-36" aria-hidden="true">
                          <span className="block h-full bg-brand-blue" style={{ width: `${week.progress}%` }} />
                        </span>
                      )}
                      {!locked && <span className="sr-only">, {week.progress}% complete</span>}
                    </>
                  );
                  return (
                    <li key={week.number}>
                      {locked ? (
                        <div title={week.unlockAt ? `Available ${new Date(week.unlockAt).toLocaleString()}` : undefined} aria-disabled="true" className="flex min-h-14 items-center gap-3 px-4 py-3 text-muted sm:px-5">{content}</div>
                      ) : (
                        <Link href={`/modules/${week.id}`} className="flex min-h-14 items-center gap-3 px-4 py-3 text-ink hover:bg-surface-muted focus-visible:outline-2 focus-visible:-outline-offset-2 focus-visible:outline-brand-blue-dark sm:px-5">{content}</Link>
                      )}
                    </li>
                  );
                })}
              </ol>
            </section>
          </div>

          <div className="min-w-0 md:col-start-2 xl:sticky xl:top-6 xl:col-start-3">
            {next ? (
              <Link href={`/modules/${next.id}`} className="block rounded-[10px] focus-visible:outline-2 focus-visible:outline-brand-blue-dark">
                <NextSession compactOnMobile moduleTitle={`Week ${next.number}: ${next.title}`} />
              </Link>
            ) : <div className="rounded-[10px] bg-white p-5 text-sm text-muted">{completed === weeks.length ? "You’ve completed all available modules." : "Upcoming modules will become available on their unlock dates."}</div>}
          </div>
        </div>
      </div>

      <nav aria-label="Mobile navigation" className="fixed inset-x-4 bottom-0 z-20 grid grid-cols-5 rounded-t-2xl border border-gray-200 bg-white px-1 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-lg md:hidden">
        {navigation.map(({ label, href, icon: Icon }) => (
          <Link key={href} href={href} aria-current={href === "/progress" ? "page" : undefined} className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-semibold focus-visible:outline-2 focus-visible:outline-brand-blue-dark ${href === "/progress" ? "text-brand-blue-dark" : "text-ink"}`}>
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </Link>
        ))}
      </nav>
    </>
  );
}
