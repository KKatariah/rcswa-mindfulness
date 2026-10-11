import type { ReactNode } from "react";
import { useRequireRole } from "@/hooks/useRequireRole";
import AdminSidebar from "@/components/admin/AdminSidebar";
import Navbar from "@/components/main/Navbar";
import Footer from "@/components/main/Footer";
import { LoadingState } from "@/components/ui/feedback";

export default function AdminLayout({ children }: { children: ReactNode }) {
	const { isLoading, denied } = useRequireRole("admin");

	return (
		<div className="min-h-screen bg-surface-muted">
			{/* Same header as the student pages: sticky, a fixed slice of the background photo under a blurred tint. */}
			<div
				className="sticky top-0 z-30 h-20 bg-cover bg-center bg-fixed bg-no-repeat lg:h-24"
				style={{ backgroundImage: "url(/images/module-background.jpg)" }}
			>
				<div className="absolute inset-0 bg-black/30 backdrop-blur-md" />
				<Navbar />
			</div>

			{isLoading ? (
				<LoadingState className="py-20" />
			) : denied ? (
				<div className="flex justify-center p-6 py-20">
					<div className="mx-auto max-w-md rounded-xl border border-gray-200 bg-white p-8 text-center shadow-card">
						<p className="font-semibold text-ink">You don&apos;t have access to this page.</p>
						<p className="mt-2 text-sm text-muted">
							The admin portal is only available to admin accounts.
						</p>
					</div>
				</div>
			) : (
				// Same width and sidebar columns as the student pages.
				<div className="mx-auto grid max-w-[1920px] items-start gap-4 p-4 md:grid-cols-[240px_minmax(0,1fr)] md:gap-6 lg:p-6 xl:grid-cols-[280px_minmax(0,1fr)]">
					<AdminSidebar />
					<div className="min-w-0">{children}</div>
				</div>
			)}

			<Footer />
		</div>
	);
}
