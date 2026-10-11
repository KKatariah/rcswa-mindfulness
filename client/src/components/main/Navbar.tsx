import { useState, type MouseEvent, type ReactNode } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { MenuIcon, XIcon } from "@/components/ui/icons";
import LoginModal from "@/components/main/LoginModal";
import SignUpModal from "@/components/main/SignUpModal";
import { useAuth } from "@/context/AuthContext";
import { useApprovalGuard } from "@/context/ApprovalModalContext";
import { UserAvatar } from "@/components/ui/UserAvatar";
import Button from "@/components/ui/Button";

const NAV_LINKS = [
	{ label: "Home", href: "/" },
	{ label: "About Us", href: "/about" },
];

const PROGRAMME_HREF = "/modules";
const PROFILE_HREF = "/profile";

// Pending users get the approval popup instead of navigating to these.
const APPROVED_ONLY_HREFS = [PROGRAMME_HREF, PROFILE_HREF];

/** `actions` sits at the right of the bar, before the account links and menu (e.g. the notifications bell). */
export default function Navbar({ actions }: { actions?: ReactNode } = {}) {
	const router = useRouter();
	const { user, logout } = useAuth();
	const guardApproval = useApprovalGuard();
	const fullName = user?.full_name?.trim() || user?.email || "";
	const [isOpen, setIsOpen] = useState(false);
	const [loginOpen, setLoginOpen] = useState(false);
	const visibleLinks = [
		...NAV_LINKS,
		...(user ? [{ label: "Programme", href: PROGRAMME_HREF }] : []),
		...(user?.role === "admin" ? [{ label: "Admin", href: "/admin" }] : []),
	];
	const [signUpOpen, setSignUpOpen] = useState(false);

	function openLogin() {
		setIsOpen(false);
		setLoginOpen(true);
	}

	function openSignUp() {
		setIsOpen(false);
		setSignUpOpen(true);
	}

	async function handleLogout() {
		setIsOpen(false);
		await logout();
		await router.push("/");
	}

	function handleLinkClick(event: MouseEvent, href: string) {
		if (APPROVED_ONLY_HREFS.includes(href)) guardApproval(event);
		setIsOpen(false);
	}

	return (
		<>
			<nav className="absolute inset-x-0 top-0 z-20 px-6 py-4 sm:px-10 lg:px-30 lg:py-5.5">
				<div className="grid grid-cols-[1fr_auto_1fr] items-center">
					{/* On phones a signed-in user sees their profile here; everyone else sees the logo. */}
					{user && (
						<Link
							href={PROFILE_HREF}
							onClick={(event) => handleLinkClick(event, PROFILE_HREF)}
							className="flex min-w-0 max-w-full items-center gap-2 justify-self-start md:hidden"
						>
							<UserAvatar
								avatarUrl={user.avatar_url}
								fullName={fullName}
								size={32}
								className="shrink-0"
							/>
							<span className="truncate text-sm font-semibold text-white">
								{fullName}
							</span>
						</Link>
					)}

					<Link href="/" className={`${user ? "hidden md:flex" : "flex"} items-center`}>
						<img src="/assets/branding/rcswa-logo-white.png" alt="RCSWA logo" width={803} height={730} className="h-10 w-auto" />
					</Link>

					<ul className="hidden items-center justify-self-center gap-7 text-md font-semibold text-white lg:flex">
						{visibleLinks.map((link) => (
							<li key={link.href}>
								<Link href={link.href} onClick={(event) => handleLinkClick(event, link.href)}>
									{link.label}
								</Link>
							</li>
						))}
					</ul>

					<div className="col-start-3 flex items-center justify-self-end gap-3">
					{actions}
					<div className="hidden items-center gap-4 lg:flex">
						{user ? (
							<>
								<Link
									href={PROFILE_HREF}
									onClick={(event) => handleLinkClick(event, PROFILE_HREF)}
									className="block max-w-64 truncate text-md font-semibold text-white hover:underline"
								>
									Hi, {user.full_name}
								</Link>
								<Button
									type="button"
									onClick={handleLogout}
									variant="onDark" size={null} className="h-11 rounded-xl px-4.5 text-md font-semibold"
								>
									Log Out
								</Button>
							</>
						) : (
							<>
								<button
									type="button"
									onClick={openLogin}
									className="text-md font-semibold text-white cursor-pointer hover:underline"
								>
									Log In
								</button>
								<Button
									type="button"
									onClick={openSignUp}
									variant="primary" size={null} className="h-11 rounded-xl px-4.5 text-md font-bold shadow-button"
								>
									Sign Up
								</Button>
							</>
						)}
					</div>

					<button
						type="button"
						onClick={() => setIsOpen((open) => !open)}
						aria-label={isOpen ? "Close menu" : "Open menu"}
						aria-expanded={isOpen}
						className="flex size-10 items-center justify-center rounded-lg text-white lg:hidden cursor-pointer hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-white"
					>
						{isOpen ? (
							<XIcon className="size-6" />
						) : (
							<MenuIcon className="size-6" />
						)}
					</button>
					</div>
				</div>

				{isOpen && (
					<div className="mt-4 flex flex-col gap-1 rounded-2xl bg-white p-4 shadow-pop lg:hidden">
						{visibleLinks.map((link) => (
							<Link
								key={link.href}
								href={link.href}
								onClick={(event) => handleLinkClick(event, link.href)}
								className="rounded-lg px-3 py-2.5 text-md font-semibold text-ink hover:underline"
							>
								{link.label}
							</Link>
						))}
						<div className="my-2 h-px w-full bg-gray-200" />
						{user ? (
							<>
								<Link
									href={PROFILE_HREF}
									onClick={(event) => handleLinkClick(event, PROFILE_HREF)}
									className="truncate rounded-lg px-3 py-2.5 text-left text-md font-semibold text-ink hover:underline"
								>
									Hi, {user.full_name}
								</Link>
								<Button
									type="button"
									onClick={handleLogout}
									variant="secondary" size={null} className="h-11 rounded-xl text-md font-semibold"
								>
									Log Out
								</Button>
							</>
						) : (
							<>
								<button
									type="button"
									onClick={openLogin}
									className="rounded-lg px-3 py-2.5 text-left text-md font-semibold text-ink cursor-pointer hover:underline"
								>
									Log In
								</button>
								<Button
									type="button"
									onClick={openSignUp}
									variant="primary" size={null} className="h-11 rounded-xl text-md font-bold"
								>
									Sign Up
								</Button>
							</>
						)}
					</div>
				)}
			</nav>

			<LoginModal isOpen={loginOpen} onClose={() => setLoginOpen(false)} />
			<SignUpModal isOpen={signUpOpen} onClose={() => setSignUpOpen(false)} />
		</>
	);
}
