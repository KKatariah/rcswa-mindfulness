import type { ReactNode } from "react";
import Navbar from "@/components/main/Navbar";
import Sidebar from "@/components/main/Sidebar";

export default function AppShell({
	children,
	rightRail,
	mobileNav,
}: {
	children: ReactNode;
	/** Optional sticky right-hand column (e.g. NextSession, a search panel). Only reserved as a grid column at the xl breakpoint. */
	rightRail?: ReactNode;
	/** Optional fixed bottom nav for small screens. When provided, the sidebar is hidden below md instead of collapsing into its own responsive layout, and the page gets extra bottom padding to clear the fixed bar. */
	mobileNav?: ReactNode;
}) {
	return (
		<div
			className="min-h-dvh bg-cover bg-center bg-fixed bg-no-repeat"
			style={{ backgroundImage: "url(/images/module-background.jpg)" }}
		>
			<div className="sticky top-0 z-30 h-20 bg-black/30 backdrop-blur-md lg:h-24">
				<Navbar />
			</div>

			<div
				className={`mx-auto grid max-w-[1920px] items-start gap-6 p-4 md:grid-cols-[240px_minmax(0,1fr)] lg:p-6 ${
					rightRail ? "xl:grid-cols-[280px_minmax(0,1fr)_320px]" : "xl:grid-cols-[280px_minmax(0,1fr)]"
				} ${mobileNav ? "pb-28" : ""}`}
			>
				<Sidebar responsive />

				<div className="min-w-0">{children}</div>

				{rightRail && (
					<div className="min-w-0 md:col-start-2 xl:sticky xl:top-24 xl:col-start-3">
						{rightRail}
					</div>
				)}
			</div>

			{mobileNav}
		</div>
	);
}
