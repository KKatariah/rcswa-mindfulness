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
			<div
				className="relative h-24 overflow-hidden bg-cover bg-center"
				style={{ backgroundImage: "url(/images/module-background.jpg)" }}
			>
				<div className="absolute inset-0 bg-gradient-to-b from-black/60 via-black/35 to-black/60" />
				<Navbar />
			</div>

			{isLoading ? (
				<LoadingState className="py-20" />
			) : denied ? (
				<div className="flex justify-center p-6 py-20">
					<div className="mx-auto max-w-md rounded-2xl border border-gray-200 bg-white p-8 text-center">
						<p className="font-semibold text-ink">You don&apos;t have access to this page.</p>
						<p className="mt-2 text-sm text-muted">
							The admin portal is only available to admin accounts.
						</p>
					</div>
				</div>
			) : (
				<div className="p-4 lg:p-6">
					<div className="mx-auto grid max-w-[1600px] gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
						<AdminSidebar />
						<div className="min-w-0">{children}</div>
					</div>
				</div>
			)}

			<Footer />
		</div>
	);
}
