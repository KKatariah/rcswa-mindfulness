import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import Sidebar from "@/components/main/Sidebar";
import NextSession from "@/components/modules/NextSession";
import { useAuth } from "@/context/AuthContext";
import {
  HomeIcon, BookOpenIcon, BarChart2Icon, MessageCircleIcon,
  FolderIcon, VideoIcon, GlobeIcon, ExternalLinkIcon,
} from "@/components/ui/icons";

const navigation = [
  { label: "Home", href: "/", icon: HomeIcon },
  { label: "Modules", href: "/modules", icon: BookOpenIcon },
  { label: "Progress", href: "/progress", icon: BarChart2Icon },
  { label: "Forum", href: "/forum", icon: MessageCircleIcon },
  { label: "Resources", href: "/resources", icon: FolderIcon },
];

type Resource = {
  title: string;
  author?: string;
  href?: string;
  /** Cover/poster/logo image, added once available — placeholders render until then. */
  cover?: string;
};

const BOOKS: Resource[] = [
  { title: "Full Catastrophe Living", author: "Jon Kabat-Zinn", cover: "/images/covers/full-catastrophe-living-j-kabatzinn.jpg" },
  { title: "Know Thyself: The Stress Release Programme", author: "Dr Craig Hassed", cover: "/images/covers/know-thyself-c-hassed.jpg" },
  { title: "Mindfulness for Life", author: "Dr Craig Hassed & Stephen McKenzie", cover: "/images/covers/mindfulness-for-life-c-hassad-s-mckenzie.jpg" },
  { title: "Hurry Up and Meditate", author: "David Michie", cover: "/images/covers/hurry-up-and-meditate-d-michie.jpg" },
  { title: "The Resilience Project: Finding Happiness Through Gratitude, Empathy and Mindfulness", author: "Hugh Van Cuylenburg", cover: "/images/covers/the-resilience-project-h-v-cuylenburg.jpg" },
  { title: "My Year of Living Mindfully", author: "Shannon Harvey", cover: "/images/covers/my-year-of-living-mindfully-s-harvey.jpg" },
];

const DOCUMENTARIES: Resource[] = [
  { title: "The Connection: Mind Your Body", author: "Shannon Harvey", href: "https://www.shannonharvey.com/pages/the-connection-documentary", cover: "/images/covers/the-connection-doc-banner.webp" },
  { title: "My Year of Living Mindfully", author: "Shannon Harvey", href: "https://www.shannonharvey.com/collections/my-year-of-living-mindfully", cover: "/images/covers/my-year-of-living-minfully-doc-banner.jpg" },
];

const ONLINE_PROGRAMS: Resource[] = [
  { title: "Online Mindfulness Based Stress Reduction Program", href: "https://www.openground.com.au/", cover: "/images/covers/openground-logo.jpg" },
  { title: "Mindful in May", href: "https://www.mindfulinmay.org/", cover: "/images/covers/mindful-in-may-logo.png" },
];

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
        <Image src={resource.cover} alt="" fill className="object-cover" />
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
        <Image src={resource.cover} alt="" fill className="object-cover" />
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
        <Image src={resource.cover} alt="" fill className="object-contain p-2" />
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
  const { user } = useAuth();
  const fullName = user?.full_name?.trim() || user?.email || "Username";

  return (
    <>
      <Head>
        <title>Resources | Wellbeing Course</title>
        <meta name="description" content="Books, documentaries, and online programmes to support your mindfulness journey." />
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
                <span>{fullName}</span>
              </div>
              <h1 className="text-2xl font-extrabold sm:text-3xl">Resources</h1>
              <p className="mt-2 text-sm md:text-muted">There are helpful materials to support your meditation journey</p>
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
                  <div key={book.title}>
                    <BookCover resource={book} />
                    <p className="mt-2 text-sm font-semibold leading-tight text-ink">{book.title}</p>
                    {book.author && <p className="mt-0.5 text-xs text-muted">{book.author}</p>}
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
                  <li key={doc.title} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
                    <PosterPlaceholder resource={doc} iconBg="bg-purple-500" Icon={VideoIcon} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink">{doc.title}</p>
                      {doc.author && <p className="mt-0.5 text-sm text-muted">{doc.author}</p>}
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
              <p className="mt-2 text-xs text-muted">
                Both films can be viewed at{" "}
                <a href="https://www.shannonharvey.com/" target="_blank" rel="noopener noreferrer" className="font-semibold text-brand-blue-dark hover:underline">
                  shannonharvey.com
                </a>
                .
              </p>
            </section>

            <section id="online-programs" aria-label="Online programs" className="scroll-mt-6 rounded-[10px] border border-gray-200 bg-white p-5 sm:p-6">
              <div className="flex items-center justify-between">
                <h2 className="text-sm font-extrabold uppercase tracking-wide text-ink">Online Programs</h2>
                <span className="text-xs text-muted">{ONLINE_PROGRAMS.length} programmes</span>
              </div>
              <ul className="mt-4 divide-y divide-gray-100">
                {ONLINE_PROGRAMS.map((program) => (
                  <li key={program.title} className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
                    <LogoThumb resource={program} iconBg="bg-green-600" Icon={GlobeIcon} />
                    <div className="min-w-0 flex-1">
                      <p className="font-semibold text-ink">{program.title}</p>
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

          <div className="min-w-0 md:col-start-2 xl:sticky xl:top-6 xl:col-start-3">
            <NextSession moduleTitle="Module Week 3" startsAt="2028-10-24T10:00:00+08:00" dateLabel="Tue, Oct 24" timeLabel="10:00 AM" />
          </div>
        </div>
      </div>

      <nav aria-label="Mobile navigation" className="fixed inset-x-4 bottom-0 z-20 grid grid-cols-5 rounded-t-2xl border border-gray-200 bg-white px-1 pt-2 pb-[max(0.5rem,env(safe-area-inset-bottom))] shadow-lg md:hidden">
        {navigation.map(({ label, href, icon: Icon }) => (
          <Link key={href} href={href} aria-current={href === "/resources" ? "page" : undefined} className={`flex min-h-12 flex-col items-center justify-center gap-1 rounded-lg text-[10px] font-semibold focus-visible:outline-2 focus-visible:outline-brand-blue-dark ${href === "/resources" ? "text-brand-blue-dark" : "text-ink"}`}>
            <Icon className="size-4" aria-hidden="true" />
            {label}
          </Link>
        ))}
      </nav>
    </>
  );
}
