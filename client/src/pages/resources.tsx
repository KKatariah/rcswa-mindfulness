import type { ReactNode } from "react";
import Head from "next/head";
import Link from "next/link";
import AppShell from "@/components/main/AppShell";
import Card from "@/components/ui/Card";
import { FullPageMessage } from "@/components/ui/feedback";
import PageHeader from "@/components/ui/PageHeader";
import { BookOpenIcon, VideoIcon, GlobeIcon, ExternalLinkIcon } from "@/components/ui/icons";
import { useAsync } from "@/hooks/useAsync";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import { listAdditionalResources } from "@/lib/api";
import { safeUrl } from "@/lib/safeUrl";
import type { AdditionalResourceCategory, AdminAdditionalResource } from "@/types/admin";

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

/** A resource's cover image, or a coloured placeholder with an icon until one is uploaded. */
function ResourceImage({
  cover,
  frame,
  imageClass = "object-cover",
  coverBg = "bg-surface-muted",
  placeholderBg,
  placeholderIcon,
}: {
  cover?: string;
  /** Size and aspect ratio, shared by the image and the placeholder. */
  frame: string;
  imageClass?: string;
  coverBg?: string;
  placeholderBg: string;
  placeholderIcon: ReactNode;
}) {
  if (cover) {
    return (
      <div className={`relative overflow-hidden rounded-lg ${frame} ${coverBg}`}>
        {/* eslint-disable-next-line @next/next/no-img-element -- covers may be served from the API's media origin, which next/image can't optimize without remotePatterns config */}
        <img src={cover} alt="" className={`absolute inset-0 size-full ${imageClass}`} />
      </div>
    );
  }
  return (
    <div className={`flex items-center justify-center rounded-lg ${frame} ${placeholderBg}`} aria-hidden="true">
      {placeholderIcon}
    </div>
  );
}

function ResourceSection({ id, title, count, children }: { id: string; title: string; count: string; children: ReactNode }) {
  return (
    <Card as="section" id={id} aria-label={title} className="scroll-mt-6 p-5 sm:p-6">
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-extrabold uppercase tracking-wide text-ink">{title}</h2>
        <span className="text-xs text-muted">{count}</span>
      </div>
      {children}
    </Card>
  );
}

/** A documentary or online programme: thumbnail, title and a link out. */
function ResourceRow({ resource, image, linkLabel }: { resource: Resource; image: ReactNode; linkLabel: string }) {
  return (
    <li className="flex items-center gap-4 py-4 first:pt-0 last:pb-0">
      {image}
      <div className="min-w-0 flex-1">
        <p className="wrap-anywhere font-semibold text-ink">{resource.title}</p>
        {resource.author && <p className="mt-0.5 wrap-anywhere text-sm text-muted">{resource.author}</p>}
      </div>
      {resource.href && (
        <a
          href={resource.href}
          target="_blank"
          rel="noopener noreferrer"
          className="flex shrink-0 items-center gap-1.5 rounded-lg border border-gray-200 px-3 py-2 text-sm font-semibold text-brand-blue-dark hover:bg-surface-muted"
        >
          {linkLabel}
          <ExternalLinkIcon className="size-3.5" aria-hidden="true" />
        </a>
      )}
    </li>
  );
}

export default function ResourcesPage() {
  const { user, isLoading: authLoading } = useRequireAuth();
  const { data: resources } = useAsync(
    () => listAdditionalResources().catch(() => [] as AdminAdditionalResource[]),
    [user],
    [] as AdminAdditionalResource[],
    { enabled: !authLoading && !!user },
  );

  if (!authLoading && !user) {
    return (
      <FullPageMessage>
        Please <Link href="/" className="text-brand-blue underline">log in</Link> to view resources.
      </FullPageMessage>
    );
  }

  const inCategory = (category: AdditionalResourceCategory) =>
    resources.filter((r) => r.category === category).map(toResource);
  const books = inCategory("book");
  const documentaries = inCategory("documentary");
  const onlinePrograms = inCategory("online_program");

  return (
    <>
      <Head>
        <title>Resources | Wellbeing Course</title>
        <meta name="description" content="Books, documentaries, and online programmes to support your mindfulness journey." />
      </Head>
      <AppShell>
        <div className="min-w-0 space-y-4">
            <PageHeader title="Resources" description="Helpful materials to support your meditation journey" />

            <Card as="section" aria-label="Featured resources" className="p-5 sm:p-6">
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
            </Card>

            <ResourceSection id="books" title="Books" count={`${books.length} titles`}>
              <div className="mt-4 grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
                {books.map((book) => (
                  <div key={book.id} className="min-w-0">
                    <ResourceImage
                      cover={book.cover}
                      frame="aspect-2/3 w-full"
                      placeholderBg="bg-blue-50"
                      placeholderIcon={<BookOpenIcon className="size-8 text-brand-blue" />}
                    />
                    <p className="mt-2 wrap-anywhere text-sm font-semibold leading-tight text-ink">{book.title}</p>
                    {book.author && <p className="mt-0.5 wrap-anywhere text-xs text-muted">{book.author}</p>}
                  </div>
                ))}
              </div>
            </ResourceSection>

            <ResourceSection id="documentaries" title="Documentaries" count={`${documentaries.length} films`}>
              <ul className="mt-4 divide-y divide-gray-100">
                {documentaries.map((doc) => (
                  <ResourceRow
                    key={doc.id}
                    resource={doc}
                    linkLabel="Watch"
                    image={
                      <ResourceImage
                        cover={doc.cover}
                        frame="aspect-video w-28 shrink-0 sm:w-36"
                        placeholderBg="bg-purple-500"
                        placeholderIcon={<VideoIcon className="size-7 text-white" />}
                      />
                    }
                  />
                ))}
              </ul>
            </ResourceSection>

            <ResourceSection id="online-programs" title="Online Programs" count={`${onlinePrograms.length} programmes`}>
              <ul className="mt-4 divide-y divide-gray-100">
                {onlinePrograms.map((program) => (
                  <ResourceRow
                    key={program.id}
                    // Programmes show no author line.
                    resource={{ ...program, author: undefined }}
                    linkLabel="Visit site"
                    image={
                      <ResourceImage
                        cover={program.cover}
                        frame="size-16 shrink-0 sm:size-20"
                        coverBg="bg-white ring-1 ring-gray-100"
                        imageClass="object-contain p-2"
                        placeholderBg="bg-green-600"
                        placeholderIcon={<GlobeIcon className="size-7 text-white" />}
                      />
                    }
                  />
                ))}
              </ul>
            </ResourceSection>
        </div>
      </AppShell>
    </>
  );
}
