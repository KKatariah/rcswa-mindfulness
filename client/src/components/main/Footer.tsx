import Link from "next/link";
import { InstagramIcon, LinkedinIcon } from "@/components/ui/icons";

const FOOTER_COLUMNS = [
	{
		title: "Course",
		links: [
			{ label: "Overview", href: "/" },
			{ label: "Modules", href: "/modules" },
		],
	},
	{
		title: "Company",
		links: [
			{ label: "About Us", href: "/about" },
			{ label: "Contact", href: "/contact" },
		],
	},
	{
		title: "Legal",
		links: [
			{ label: "Privacy", href: "/privacy" },
			{ label: "Terms", href: "/terms" },
		],
	},
];

const SOCIAL_LINKS = [
	{ label: "Instagram", href: "https://instagram.com", icon: InstagramIcon },
	{ label: "LinkedIn", href: "https://linkedin.com", icon: LinkedinIcon },
];

export default function Footer() {
	return (
		<footer className="bg-ink px-6 py-16 sm:px-10 lg:px-30">
			<div className="flex flex-col justify-between gap-12 lg:flex-row lg:items-start">
				<div className="max-w-xs">
					<span className="text-lg font-bold text-white">logo</span>
					<p className="mt-4 text-[15px] text-white/50">
						An 8-week guided meditation journey for lasting wellbeing.
					</p>
				</div>

				<div className="grid grid-cols-3 gap-8 sm:gap-16">
					{FOOTER_COLUMNS.map((column) => (
						<div key={column.title} className="flex flex-col gap-3">
							<h3 className="text-sm font-bold text-white">{column.title}</h3>
							<ul className="flex flex-col gap-2.5">
								{column.links.map((link) => (
									<li key={link.label}>
										<Link href={link.href} className="text-sm text-white/50">
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

			<div className="flex flex-col items-center justify-between gap-4 sm:flex-row">
				<p className="text-sm text-white/50">
					© {new Date().getFullYear()} Wellbeing Course. All rights reserved.
				</p>

				<div className="flex items-center gap-3">
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
