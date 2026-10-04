import { useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import { MenuIcon, XIcon } from "@/components/ui/icons";
import LoginModal from "@/components/main/LoginModal";
import SignUpModal from "@/components/main/SignUpModal";
import { useAuth } from "@/context/AuthContext";
import { UserAvatar } from "@/components/ui/UserAvatar";

const NAV_LINKS = [
	{ label: "Home", href: "/" },
	{ label: "About Us", href: "/about" },
];

export default function Navbar() {
	const router = useRouter();
	const { user, logout } = useAuth();
	const fullName = user?.full_name?.trim() || user?.email || "";
	const [isOpen, setIsOpen] = useState(false);
	const [loginOpen, setLoginOpen] = useState(false);
	const visibleLinks = [
		...NAV_LINKS,
		...(user ? [{ label: "Programme", href: "/modules" }] : []),
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

	return (
		<>
			<nav className="absolute inset-x-0 top-0 z-20 px-6 py-4 sm:px-10 lg:px-30 lg:py-5.5">
				<div className="grid grid-cols-[1fr_auto_1fr] items-center">
					{/* On phones a signed-in user sees their profile here; everyone else sees the logo. */}
					{user && (
						<Link
							href="/profile"
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

					<Link href="/" className={`${user ? "hidden md:flex" : "flex"} items-center gap-3`}>
						<span className="size-9 shrink-0 rounded-[10px] bg-brand-blue" />
						<span className="text-lg font-bold text-white">logo</span>
					</Link>

					<ul className="hidden items-center justify-self-center gap-7 text-[15px] font-semibold text-white lg:flex">
						{visibleLinks.map((link) => (
							<li key={link.href}>
								<Link href={link.href}>{link.label}</Link>
							</li>
						))}
					</ul>

					<div className="hidden items-center justify-self-end gap-4 lg:flex">
						{user ? (
							<>
								<Link
									href="/profile"
									className="block max-w-64 truncate text-[15px] font-semibold text-white hover:underline"
								>
									Hi, {user.full_name}
								</Link>
								<button
									type="button"
									onClick={handleLogout}
									className="flex h-11 items-center justify-center rounded-xl bg-brand-blue px-4.5 text-[15px] font-bold text-white shadow-[0px_6px_8px_rgba(0,0,0,0.1)]"
								>
									Log Out
								</button>
							</>
						) : (
							<>
								<button
									type="button"
									onClick={openLogin}
									className="text-[15px] font-semibold text-white"
								>
									Log In
								</button>
								<button
									type="button"
									onClick={openSignUp}
									className="flex h-11 items-center justify-center rounded-xl bg-brand-blue px-4.5 text-[15px] font-bold text-white shadow-[0px_6px_8px_rgba(0,0,0,0.1)]"
								>
									Sign Up
								</button>
							</>
						)}
					</div>

					<button
						type="button"
						onClick={() => setIsOpen((open) => !open)}
						aria-label={isOpen ? "Close menu" : "Open menu"}
						aria-expanded={isOpen}
						className="col-start-3 flex size-10 items-center justify-self-end rounded-lg text-white lg:hidden"
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
						{visibleLinks.map((link) => (
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
						{user ? (
							<>
								<Link
									href="/profile"
									onClick={() => setIsOpen(false)}
									className="truncate rounded-lg px-3 py-2.5 text-left text-[15px] font-semibold text-ink"
								>
									Hi, {user.full_name}
								</Link>
								<button
									type="button"
									onClick={handleLogout}
									className="flex h-11 items-center justify-center rounded-xl bg-brand-blue text-[15px] font-bold text-white"
								>
									Log Out
								</button>
							</>
						) : (
							<>
								<button
									type="button"
									onClick={openLogin}
									className="rounded-lg px-3 py-2.5 text-left text-[15px] font-semibold text-ink"
								>
									Log In
								</button>
								<button
									type="button"
									onClick={openSignUp}
									className="flex h-11 items-center justify-center rounded-xl bg-brand-blue text-[15px] font-bold text-white"
								>
									Sign Up
								</button>
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
