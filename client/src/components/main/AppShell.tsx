import { useSyncExternalStore, type ReactNode } from "react";
import Sidebar from "@/components/main/Sidebar";
import { useAuth } from "@/context/AuthContext";

// Returns true only once mounted on the client, false during SSR and the
// first client render — same hydration-safety purpose as the old
// useState+useEffect(() => setMounted(true)) pattern, but without calling
// setState from inside an effect (avoids react-hooks/set-state-in-effect).
function useMounted() {
	return useSyncExternalStore(
		() => () => {},
		() => true,
		() => false,
	);
}

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
	const mounted = useMounted();
	const showSidebar = mounted && Boolean(user);

	return (
		<div className="relative flex min-h-screen">
			{background && <div className="absolute inset-0 -z-10">{background}</div>}

			<div className={`flex min-h-screen w-full ${background ? "" : "bg-surface-muted"}`}>
				{showSidebar && (
					<div className={`sticky top-0 h-screen shrink-0 ${background ? "p-4" : ""}`}>
						<Sidebar />
					</div>
				)}
				<div className="min-w-0 flex-1">{children}</div>
			</div>
		</div>
	);
}
