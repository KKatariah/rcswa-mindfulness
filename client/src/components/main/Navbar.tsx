import { useState } from "react";
import Link from "next/link";
import { MenuIcon, XIcon } from "@/components/ui/icons";

const NAV_LINKS = [
	{ label: "Home", href: "/" },
	{ label: "Modules", href: "/modules" },
	{ label: "About Us", href: "/about" },
];

export default function Navbar() {
	const [isOpen, setIsOpen] = useState(false);

	return (
		<nav className="absolute inset-x-0 top-0 z-20 px-6 py-4 sm:px-10 lg:px-[7.5rem] lg:py-[1.375rem]">
			<div className="flex items-center justify-between">
				<Link href="/" className="flex items-center gap-3">
					<span className="size-9 shrink-0 rounded-[10px] bg-brand-blue" />
					<span className="text-lg font-bold text-white">logo</span>
				</Link>

				<ul className="hidden items-center gap-7 text-[15px] font-semibold text-white lg:flex">
					{NAV_LINKS.map((link) => (
						<li key={link.href}>
							<Link href={link.href}>{link.label}</Link>
						</li>
					))}
				</ul>

				<div className="hidden items-center gap-4 lg:flex">
					<Link href="/login" className="text-[15px] font-semibold text-white">
						Log In
					</Link>
					<Link
						href="/signup"
						className="flex h-11 items-center justify-center rounded-xl bg-brand-blue px-4.5 text-[15px] font-bold text-white shadow-[0px_6px_8px_rgba(0,0,0,0.1)]"
					>
						Sign Up
					</Link>
				</div>

				<button
					type="button"
					onClick={() => setIsOpen((open) => !open)}
					aria-label={isOpen ? "Close menu" : "Open menu"}
					aria-expanded={isOpen}
					className="flex size-10 items-center justify-center rounded-lg text-white lg:hidden"
				>
					{isOpen ? (
						<XIcon className="size-6" />
					) : (
						<MenuIcon className="size-6" />
					)}
				</button>
			</div>

			{isOpen && (
				<div className="mt-4 flex flex-col gap-1 rounded-2xl bg-white p-4 shadow-[0px_10px_20px_rgba(0,0,0,0.15)] lg:hidden">
					{NAV_LINKS.map((link) => (
						<Link
							key={link.href}
							href={link.href}
							onClick={() => setIsOpen(false)}
							className="rounded-lg px-3 py-2.5 text-[15px] font-semibold text-ink"
						>
							{link.label}
						</Link>
					))}
					<div className="my-2 h-px w-full bg-gray-200" />
					<Link
						href="/login"
						onClick={() => setIsOpen(false)}
						className="rounded-lg px-3 py-2.5 text-[15px] font-semibold text-ink"
					>
						Log In
					</Link>
					<Link
						href="/signup"
						onClick={() => setIsOpen(false)}
						className="flex h-11 items-center justify-center rounded-xl bg-brand-blue text-[15px] font-bold text-white"
					>
						Sign Up
					</Link>
				</div>
			)}
		</nav>
	);
}
