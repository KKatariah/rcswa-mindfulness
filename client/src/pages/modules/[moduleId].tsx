import { useEffect, useState } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import Head from "next/head";
import Navbar from "@/components/main/Navbar";
import Footer from "@/components/main/Footer";
import Sidebar from "@/components/main/Sidebar";
import NextSession from "@/components/modules/NextSession";
import ModuleHeader from "@/components/modules/ModuleHeader";
import ModuleContent from "@/components/modules/ModuleContent";
import { useAuth } from "@/context/AuthContext";
import {
	deleteContentCompletion,
	getModule,
	listModuleViews,
	listProgress,
	markContentComplete,
	markModuleViewed,
	type ApiModuleDetail,
} from "@/lib/api";
import type { ContentBlock } from "@/types/module";

// Background photo by Michael Metschl (Pexels): https://www.pexels.com/photo/18284929/

// Maps content_item id -> its completion row id, so a completed item can be un-completed via DELETE.
function toBlocks(module: ApiModuleDetail, completions: Map<number, number>): ContentBlock[] {
	const blocks: ContentBlock[] = [];
	if (module.description) {
		blocks.push({ id: "description", type: "text", content: module.description });
	}
	for (const item of module.content_items) {
		blocks.push({
			id: item.id,
			type: item.type,
			title: item.title,
			embedUrl: item.embed_url,
			completed: completions.has(item.id),
		});
	}
	return blocks;
}

export default function ModulePage() {
	const router = useRouter();
	const { moduleId } = router.query;
	const { user, isLoading: authLoading } = useAuth();

	useEffect(() => {
		if (!authLoading && !user) {
			router.replace("/");
		}
	}, [authLoading, user, router]);

	const [module, setModule] = useState<ApiModuleDetail | null>(null);
	const [completions, setCompletions] = useState<Map<number, number>>(new Map());
	const [moduleViewed, setModuleViewed] = useState(false);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		if (authLoading || !router.isReady) return;

		let cancelled = false;

		(async () => {
			if (!user) {
				if (!cancelled) setLoading(false);
				return;
			}

			setLoading(true);
			setError(null);

			const token = localStorage.getItem("token") ?? "";
			try {
				const [moduleData, progressData, viewsData] = await Promise.all([
					getModule(moduleId as string, token),
					listProgress(token),
					listModuleViews(token),
				]);
				if (cancelled) return;
				setModule(moduleData);
				setCompletions(new Map(progressData.map((p) => [p.content_item, p.id])));

				const alreadyViewed = viewsData.some((v) => v.module === moduleData.id);
				setModuleViewed(alreadyViewed);

				// Opening this page counts as viewing the module.
				if (!alreadyViewed) {
					markModuleViewed(moduleData.id, token)
						.then(() => {
							if (!cancelled) setModuleViewed(true);
						})
						.catch(() => {});
				}
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load module");
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();

		return () => { cancelled = true; };
	}, [authLoading, router.isReady, moduleId, user]);

	async function handleToggleComplete(contentItemId: number) {
		const token = localStorage.getItem("token") ?? "";
		const existingCompletionId = completions.get(contentItemId);

		if (existingCompletionId !== undefined) {
			setCompletions((prev) => {
				const next = new Map(prev);
				next.delete(contentItemId);
				return next;
			});
			try {
				await deleteContentCompletion(existingCompletionId, token);
			} catch {
				setCompletions((prev) => new Map(prev).set(contentItemId, existingCompletionId));
			}
		} else {
			setCompletions((prev) => new Map(prev).set(contentItemId, -1));
			try {
				const completion = await markContentComplete(contentItemId, token);
				setCompletions((prev) => new Map(prev).set(contentItemId, completion.id));
			} catch {
				setCompletions((prev) => {
					const next = new Map(prev);
					next.delete(contentItemId);
					return next;
				});
			}
		}
	}

	if (!authLoading && !user) {
		return (
			<div className="flex min-h-screen items-center justify-center p-6">
				<p className="text-ink-soft">
					Please <Link href="/" className="text-brand-blue underline">log in</Link> to view this module.
				</p>
			</div>
		);
	}

	if (loading || authLoading) {
		return (
			<div className="flex min-h-screen items-center justify-center p-6">
				<p className="text-ink-soft">Loading module…</p>
			</div>
		);
	}

	if (error || !module) {
		return (
			<div className="flex min-h-screen items-center justify-center p-6">
				<p className="text-ink-soft">{error ?? "Module not found."}</p>
			</div>
		);
	}

	return (
		<>
			<Head>
				<title>{module.title}</title>
			</Head>
			<div
				className="bg-cover bg-center bg-fixed bg-no-repeat"
				style={{ backgroundImage: "url(/images/module-background.jpg)" }}
			>
				<div className="sticky top-0 z-30 h-20 bg-black/30 backdrop-blur-md lg:h-24">
					<Navbar />
				</div>

				<div className="mx-auto grid max-w-[1920px] items-start gap-6 p-4 md:grid-cols-[240px_minmax(0,1fr)] lg:p-6 xl:grid-cols-[280px_minmax(0,1fr)_320px]">
					<Sidebar responsive />
					<div className="flex min-w-0 flex-col rounded-[10px] border border-gray-200 bg-white shadow-[0_6px_9px_rgba(0,0,0,0.05)]">
						<ModuleHeader
							embedded
							title={module.title}
							durationMinutes={module.content_items.length * 10}
							description={`Week ${module.week_number}`}
							viewed={moduleViewed}
						/>

						<hr className="mx-6 mt-6 border-0 border-t border-gray-200 sm:mx-10 lg:mx-12" />
						<ModuleContent blocks={toBlocks(module, completions)} embedded onToggleComplete={handleToggleComplete} />
					</div>
					<div className="min-w-0 md:col-start-2 xl:col-start-3 md:sticky md:top-20 lg:top-24">
						{/* Sample schedule until session data is connected. */}
						<NextSession moduleTitle="Module Week 3" startsAt="2028-10-24T10:00:00+08:00" dateLabel="Tue, Oct 24" timeLabel="10:00 AM" />
					</div>
				</div>
			</div>

			<Footer />
		</>
	);
}
