import Head from "next/head";
import Image from "next/image";
import Link from "next/link";
import AppShell from "@/components/main/AppShell";
import NextSession from "@/components/modules/NextSession";
import { BookOpenIcon, VideoIcon, GlobeIcon, ExternalLinkIcon } from "@/components/ui/icons";

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
  return (
    <>
      <Head>
        <title>Resources | Wellbeing Course</title>
        <meta name="description" content="Books, documentaries, and online programmes to support your mindfulness journey." />
      </Head>
      <AppShell
        rightRail={
          <NextSession moduleTitle="Module Week 3" startsAt="2028-10-24T10:00:00+08:00" dateLabel="Tue, Oct 24" timeLabel="10:00 AM" />
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
      </AppShell>
    </>
  );
}
