import Link from "next/link";
import { GlobeIcon, LinkedinIcon } from "@/components/ui/icons";
import { useAuth } from "@/context/AuthContext";
import { useApprovalGuard } from "@/context/ApprovalModalContext";

const PROGRAMME_HREF = "/modules";

const FOOTER_COLUMNS = [
  {
    title: "Course",
    links: [
      { label: "Overview", href: "/" },
      { label: "Programme", href: PROGRAMME_HREF },
    ],
  },
  {
    title: "Company",
    links: [{ label: "About Us", href: "/about" }],
  },
];

const SOCIAL_LINKS = [
  {
    label: "LinkedIn",
    href: "https://www.linkedin.com/in/dr-sarah-moore-84a0902a/",
    icon: LinkedinIcon,
  },
  {
    label: "Research Repository",
    href: "https://research-repository.uwa.edu.au/en/persons/sarah-moore/",
    icon: GlobeIcon,
  },
];

export default function Footer() {
  const { user } = useAuth();
  const guardApproval = useApprovalGuard();

  return (
    <footer className="bg-ink px-6 py-16 sm:px-10 lg:px-30">
      <div className="flex flex-col justify-between gap-12 lg:flex-row lg:items-start">
        <div className="max-w-xs">
          <img src="/assets/branding/rcswa-logo-white.png" alt="RCSWA logo" width={803} height={730} className="h-16 w-auto" />
          <p className="mt-4 text-md text-white/50">
            An 8-week guided meditation journey for lasting wellbeing.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-8 sm:gap-16">
          {FOOTER_COLUMNS.map((column) => (
            <div key={column.title} className="flex flex-col gap-3">
              <h2 className="text-sm font-bold text-white">{column.title}</h2>
              <ul className="flex flex-col gap-2.5">
                {column.links
                  // Programme is only shown when logged in.
                  .filter((link) => link.href !== PROGRAMME_HREF || user)
                  .map((link) => (
                    <li key={link.label}>
                      <Link
                        href={link.href}
                        // Pending users get the approval popup instead of navigating.
                        onClick={link.href === PROGRAMME_HREF ? guardApproval : undefined}
                        className="text-sm text-white/50"
                      >
                        {link.label}
                      </Link>
                    </li>
                  ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      <div className="my-8 h-px w-full bg-white/10" />

      <div className="flex flex-wrap items-center justify-between gap-4">
        <p className="text-sm text-white/50">
          © {new Date().getFullYear()} RCSWA Wellbeing. All rights reserved.
        </p>

        <div className="flex items-center gap-3">
          <a
            href="mailto:sara.j.moore@rcswa.edu.au"
            className="text-sm text-white/50 transition-colors hover:text-white/80"
          >
            sara.j.moore@rcswa.edu.au
          </a>

          {SOCIAL_LINKS.map(({ label, href, icon: Icon }) => (
            <a
              key={label}
              href={href}
              target="_blank"
              rel="noopener noreferrer"
              aria-label={label}
              className="flex size-9 items-center justify-center rounded-full bg-white/10 text-white"
            >
              <Icon className="size-4" />
            </a>
          ))}
        </div>
      </div>
    </footer>
  );
}
