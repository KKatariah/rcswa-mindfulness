import type { ReactNode } from "react";
import Navbar from "@/components/main/Navbar";
import Sidebar from "@/components/main/Sidebar";
import Footer from "@/components/main/Footer";
import { NotificationsBell, NotificationsProvider } from "@/components/notifications/NotificationsPanel";

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
		// One copy of the notifications, shared by the rail card and the header bell.
		<NotificationsProvider>
			<div
				className="min-h-dvh bg-cover bg-center bg-fixed bg-no-repeat"
				style={{ backgroundImage: "url(/images/module-background.jpg)" }}
			>
				<div className="sticky top-0 z-30 h-20 bg-black/30 backdrop-blur-md lg:h-24">
					{/* The bell stands in for the rail's Notifications card wherever the rail is hidden. */}
					<Navbar actions={<div className="xl:hidden"><NotificationsBell /></div>} />
				</div>

				<div
					className={`mx-auto grid max-w-[1920px] items-start gap-6 p-4 md:grid-cols-[240px_minmax(0,1fr)] lg:p-6 ${
						rightRail ? "xl:grid-cols-[280px_minmax(0,1fr)_320px]" : "xl:grid-cols-[280px_minmax(0,1fr)]"
					} ${mobileNav ? "pb-28" : ""}`}
				>
					<Sidebar />

					<div className="min-w-0">{children}</div>

					{/* Capped to the viewport and scrollable, so a tall rail (e.g. an open notifications panel) stays reachable while sticky. Its scrollbar is hidden so it doesn't sit next to the notification list's own.
					    Only shown beside the content (xl and up): below that it would stack under the page, so it's hidden and
					    Notifications moves to the bell in the header. */}
					{rightRail && (
						<div className="hidden min-w-0 xl:sticky xl:block xl:top-24 xl:col-start-3 xl:-mx-2 xl:max-h-[calc(100dvh-7.5rem)] xl:overflow-y-auto xl:overscroll-contain xl:px-2 xl:pb-3 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
							{rightRail}
						</div>
					)}
				</div>

				{mobileNav}
			</div>

			{/* On phones the fixed bottom nav would cover the end of the footer, so it gets room to scroll clear. */}
			<div className="bg-ink pb-(--mobile-bottom-nav-height) md:pb-0">
				<Footer />
			</div>
		</NotificationsProvider>
	);
}
