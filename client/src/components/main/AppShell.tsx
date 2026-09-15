import { useEffect, useState, type ReactNode } from "react";
import Sidebar from "@/components/main/Sidebar";
import { useAuth } from "@/context/AuthContext";

export default function AppShell({
	children,
	background,
}: {
	children: ReactNode;
	/** Optional full-page background layer (e.g. an <Image fill /> + gradient overlay).
	 *  When provided, it renders fixed behind everything and replaces the default
	 *  bg-surface-muted so the image shows through around the cards/sidebar. */
	background?: ReactNode;
}) {
	const { user } = useAuth();
	const [mounted, setMounted] = useState(false);

	// Auth state isn't available during SSR, so `user` can differ between the
	// server render and the first client render. Only trust `user` once
	// mounted so the first client render matches the server render and React
	// doesn't flag a hydration mismatch (same pattern as Navbar).
	useEffect(() => {
		setMounted(true);
	}, []);
	const showSidebar = mounted && Boolean(user);

	return (
		<div className="relative flex min-h-screen">
			{background && <div className="absolute inset-0 -z-10">{background}</div>}

			<div className={`flex min-h-screen w-full ${background ? "" : "bg-surface-muted"}`}>
				{showSidebar && (
					<div className="sticky top-0 h-screen shrink-0">
						<Sidebar />
					</div>
				)}
				<div className="min-w-0 flex-1">{children}</div>
			</div>
		</div>
	);
}
