import Head from "next/head";
import Link from "next/link";
import { useEffect, useState } from "react";
import AppShell from "@/components/main/AppShell";
import UpcomingSession from "@/components/modules/UpcomingSession";
import NotificationsPanel from "@/components/notifications/NotificationsPanel";
import { BookOpenIcon, VideoIcon, GlobeIcon, ExternalLinkIcon } from "@/components/ui/icons";
import { useAuth } from "@/context/AuthContext";
import { listAdditionalResources } from "@/lib/api";
import { safeUrl } from "@/lib/safeUrl";
import type { AdminAdditionalResource } from "@/types/admin";
import { pageTitle } from "@/lib/pageTitle";

type Resource = {
  id: number;
  title: string;
  author?: string;
  href?: string;
  /** Cover/poster/logo image, added once available — placeholders render until then. */
  cover?: string;
};

function toResource(r: AdminAdditionalResource): Resource {
  return {
    id: r.id,
    title: r.title,
    author: r.author || undefined,
    href: safeUrl(r.url),
    cover: safeUrl(r.cover_image),
  };
}

const FEATURED = [
  {
    id: "books",
    label: "Books",
    description: "Recommended reading to support your practice",
    icon: BookOpenIcon,
    cardBg: "bg-blue-50",
    iconBg: "bg-brand-blue",
  },
  {
    id: "documentaries",
    label: "Documentaries",
    description: "Watch and learn mindfulness stories",
    icon: VideoIcon,
    cardBg: "bg-purple-50",
    iconBg: "bg-purple-500",
  },
  {
    id: "online-programs",
    label: "Online Programs",
    description: "Guided courses beyond this programme",
    icon: GlobeIcon,
    cardBg: "bg-green-50",
    iconBg: "bg-green-600",
  },
] as const;

function BookCover({ resource }: { resource: Resource }) {
  if (resource.cover) {
    return (
      <div className="relative aspect-2/3 w-full overflow-hidden rounded-lg bg-surface-muted">
        {/* eslint-disable-next-line @next/next/no-img-element -- covers may be served from the API's media origin, which next/image can't optimize without remotePatterns config */}
        <img src={resource.cover} alt="" className="absolute inset-0 size-full object-cover" />
      </div>
    );
  }
  return (
    <div className="flex aspect-2/3 w-full items-center justify-center rounded-lg bg-blue-50" aria-hidden="true">
      <BookOpenIcon className="size-8 text-brand-blue" />
    </div>
  );
}

function PosterPlaceholder({ resource, iconBg, Icon }: { resource: Resource; iconBg: string; Icon: typeof VideoIcon }) {
  if (resource.cover) {
    return (
      <div className="relative aspect-video w-28 shrink-0 overflow-hidden rounded-lg bg-surface-muted sm:w-36">
        {/* eslint-disable-next-line @next/next/no-img-element -- covers may be served from the API's media origin, which next/image can't optimize without remotePatterns config */}
        <img src={resource.cover} alt="" className="absolute inset-0 size-full object-cover" />
      </div>
    );
  }
  return (
    <div className={`flex aspect-video w-28 shrink-0 items-center justify-center rounded-lg sm:w-36 ${iconBg}`} aria-hidden="true">
      <Icon className="size-7 text-white" />
    </div>
  );
}

function LogoThumb({ resource, iconBg, Icon }: { resource: Resource; iconBg: string; Icon: typeof GlobeIcon }) {
  if (resource.cover) {
    return (
      <div className="relative size-16 shrink-0 overflow-hidden rounded-lg bg-white ring-1 ring-gray-100 sm:size-20">
        {/* eslint-disable-next-line @next/next/no-img-element -- covers may be served from the API's media origin, which next/image can't optimize without remotePatterns config */}
        <img src={resource.cover} alt="" className="absolute inset-0 size-full object-contain p-2" />
      </div>
    );
  }
  return (
    <div className={`flex size-16 shrink-0 items-center justify-center rounded-lg sm:size-20 ${iconBg}`} aria-hidden="true">
      <Icon className="size-7 text-white" />
    </div>
  );
}

export default function ResourcesPage() {
  const { user, isLoading: authLoading } = useAuth();
  const [resources, setResources] = useState<AdminAdditionalResource[]>([]);

  useEffect(() => {
    if (authLoading || !user) return;
    const token = localStorage.getItem("token") ?? "";
    listAdditionalResources(token)
      .then(setResources)
      .catch(() => setResources([]));
  }, [user, authLoading]);

  if (!authLoading && !user) {
    return (
      <div className="flex min-h-screen items-center justify-center p-6">
        <p className="text-ink-soft">
          Please <Link href="/" className="text-brand-blue underline">log in</Link> to view resources.
        </p>
      </div>
    );
  }

  const BOOKS = resources.filter((r) => r.category === "book").map(toResource);
  const DOCUMENTARIES = resources.filter((r) => r.category === "documentary").map(toResource);
  const ONLINE_PROGRAMS = resources.filter((r) => r.category === "online_program").map(toResource);

  return (
    <>
      <Head>
        <title>{pageTitle("Resources")}</title>
        <meta name="description" content="Books, documentaries, and online programmes to support your mindfulness journey." />
      </Head>
      <AppShell
        rightRail={
          <div className="space-y-4">
            <UpcomingSession />
            <NotificationsPanel />
          </div>
        }
      >
        <div className="min-w-0 space-y-4">
            <header className="rounded-[10px] border border-gray-200 bg-white p-6 shadow-[0_4px_4px_-6px_rgba(0,0,0,0.05)]">
              <h1 className="text-2xl font-extrabold text-ink sm:text-3xl">Resources</h1>
              <p className="mt-2 text-sm text-muted sm:text-base">Helpful materials to support your meditation journey</p>
            </header>

            <section aria-label="Featured resources" className="rounded-[10px] border border-gray-200 bg-white p-5 sm:p-6">
              <h2 className="text-sm font-bold text-ink">Featured resources</h2>
              <div className="mt-4 grid gap-4 sm:grid-cols-3">
                {FEATURED.map(({ id, label, description, icon: Icon, cardBg, iconBg }) => (
                  <Link
                    key={id}
                    href={`#${id}`}
                    className={`rounded-2xl p-5 transition-transform hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-brand-blue-dark ${cardBg}`}
                  >
                    <span className={`flex size-10 items-center justify-center rounded-xl text-white ${iconBg}`}>
                      <Icon className="size-5" aria-hidden="true" />
                    </span>
                    <h3 className="mt-4 font-bold text-ink">{label}</h3>
                    <p className="mt-1 text-sm text-muted">{description}</p>
                  </Link>
                ))}
              </div>
            </section>

            <section id="books" aria-label="Books" className="scroll-mt-6 rounded-[10px] border border-gray-200 bg-white p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-extrabold uppercase tracking-wide text-ink">Books</h2>
                <span className="text-xs text-muted">{BOOKS.length} titles</span>
              </div>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {BOOKS.map((book) => (
                  <div key={book.id} className="min-w-0">
                    <BookCover resource={book} />
                    <p className="mt-2 wrap-anywhere text-sm font-semibold leading-tight text-ink">{book.title}</p>
                    {book.author && <p className="mt-0.5 wrap-anywhere text-xs text-muted">{book.author}</p>}
                  </div>
                ))}
              </div>
            </section>

            <section id="documentaries" aria-label="Documentaries" className="scroll-mt-6 rounded-[10px] border border-gray-200 bg-white p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-extrabold uppercase tracking-wide text-ink">Documentaries</h2>
                <span className="text-xs text-muted">{DOCUMENTARIES.length} films</span>
              </div>
              <ul className="mt-4 divide-y divide-gray-100">
                {DOCUMENTARIES.map((doc) => (
                  <li key={doc.id} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
                    <PosterPlaceholder resource={doc} iconBg="bg-purple-500" Icon={VideoIcon} />
                    <div className="min-w-0 flex-1">
                      <p className="wrap-anywhere font-semibold text-ink">{doc.title}</p>
                      {doc.author && <p className="mt-0.5 wrap-anywhere text-sm text-muted">{doc.author}</p>}
                    </div>
                    {doc.href && (
                      <a
                        href={doc.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-brand-blue-dark hover:bg-surface-muted"
                      >
                        Watch
                        <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </section>

            <section id="online-programs" aria-label="Online programs" className="scroll-mt-6 rounded-[10px] border border-gray-200 bg-white p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-extrabold uppercase tracking-wide text-ink">Online Programs</h2>
                <span className="text-xs text-muted">{ONLINE_PROGRAMS.length} programmes</span>
              </div>
              <ul className="mt-4 divide-y divide-gray-100">
                {ONLINE_PROGRAMS.map((program) => (
                  <li key={program.id} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
                    <LogoThumb resource={program} iconBg="bg-green-600" Icon={GlobeIcon} />
                    <div className="min-w-0 flex-1">
                      <p className="wrap-anywhere font-semibold text-ink">{program.title}</p>
                    </div>
                    {program.href && (
                      <a
                        href={program.href}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-brand-blue-dark hover:bg-surface-muted"
                      >
                        Visit site
                        <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
                      </a>
                    )}
                  </li>
                ))}
              </ul>
            </section>
        </div>
      </AppShell>
    </>
  );
}
