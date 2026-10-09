import { useEffect } from "react";
import { useRouter } from "next/router";
import Link from "next/link";
import Head from "next/head";
import AppShell from "@/components/main/AppShell";
import UpcomingSession from "@/components/modules/UpcomingSession";
import NotificationsPanel from "@/components/notifications/NotificationsPanel";
import ModuleHeader from "@/components/modules/ModuleHeader";
import ModuleContent from "@/components/modules/ModuleContent";
import Card from "@/components/ui/Card";
import { FullPageMessage } from "@/components/ui/feedback";
import { useAsync } from "@/hooks/useAsync";
import { useRequireAuth } from "@/hooks/useRequireAuth";
import {
	deleteContentCompletion,
	getModule,
	listModuleViews,
	listProgress,
	markContentComplete,
	markModuleViewed,
	type ApiModuleDetail,
} from "@/lib/api";
import { weekLabel } from "@/lib/weeks";
import type { ContentBlock } from "@/types/module";
import { pageTitle } from "@/lib/pageTitle";

// Background photo by Michael Metschl (Pexels): https://www.pexels.com/photo/18284929/

type ModulePageData = {
	module: ApiModuleDetail | null;
	// Maps content_item id -> its completion row id, so a completed item can be un-completed via DELETE.
	completions: Map<number, number>;
	viewed: boolean;
};

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
	const { user, isLoading: authLoading } = useRequireAuth();

	const { data, setData, loading, error } = useAsync<ModulePageData>(
		async () => {
			const [module, progress, views] = await Promise.all([getModule(moduleId as string), listProgress(), listModuleViews()]);
			return {
				module,
				completions: new Map(progress.map((p) => [p.content_item, p.id])),
				viewed: views.some((v) => v.module === module.id),
			};
		},
		[moduleId, user],
		{ module: null, completions: new Map(), viewed: false },
		{ enabled: !authLoading && router.isReady && !!user, errorFallback: "Failed to load module" },
	);
	const { module, completions } = data;

	// Opening this page counts as viewing the module. Recorded in the background.
	const loadedModuleId = module?.id;
	const viewed = data.viewed;
	useEffect(() => {
		if (loadedModuleId === undefined || viewed) return;
		let cancelled = false;
		markModuleViewed(loadedModuleId)
			.then(() => {
				if (!cancelled) setData((d) => ({ ...d, viewed: true }));
			})
			.catch(() => {});
		return () => {
			cancelled = true;
		};
	}, [loadedModuleId, viewed, setData]);

	function setCompletions(update: (prev: Map<number, number>) => Map<number, number>) {
		setData((d) => ({ ...d, completions: update(d.completions) }));
	}

	function withoutItem(map: Map<number, number>, contentItemId: number) {
		const next = new Map(map);
		next.delete(contentItemId);
		return next;
	}

	async function handleToggleComplete(contentItemId: number) {
		const existingCompletionId = completions.get(contentItemId);

		// Update the checkbox straight away, and undo it if the server refuses.
		if (existingCompletionId !== undefined) {
			setCompletions((prev) => withoutItem(prev, contentItemId));
			try {
				await deleteContentCompletion(existingCompletionId);
			} catch {
				setCompletions((prev) => new Map(prev).set(contentItemId, existingCompletionId));
			}
		} else {
			setCompletions((prev) => new Map(prev).set(contentItemId, -1));
			try {
				const completion = await markContentComplete(contentItemId);
				setCompletions((prev) => new Map(prev).set(contentItemId, completion.id));
			} catch {
				setCompletions((prev) => withoutItem(prev, contentItemId));
			}
		}
	}

	if (!authLoading && !user) {
		return (
			<FullPageMessage>
				Please <Link href="/" className="text-brand-blue underline">log in</Link> to view this module.
			</FullPageMessage>
		);
	}

	if (loading || authLoading) {
		return <FullPageMessage>Loading module…</FullPageMessage>;
	}

	if (error || !module) {
		return <FullPageMessage>{error ?? "Module not found."}</FullPageMessage>;
	}

	return (
		<>
			<Head>
				<title>{pageTitle(module.title)}</title>
			</Head>
			<AppShell
				rightRail={
					<div className="space-y-4">
						<UpcomingSession />
						<NotificationsPanel />
					</div>
				}
			>
				<Card className="flex min-w-0 flex-col">
					<ModuleHeader
						embedded
						title={module.title}
						durationMinutes={module.content_items.length * 10}
						eyebrow={weekLabel(module.week_number)}
						viewed={data.viewed}
					/>

					<hr className="mx-6 mt-6 border-0 border-t border-gray-200 sm:mx-8" />
					<ModuleContent blocks={toBlocks(module, completions)} embedded onToggleComplete={handleToggleComplete} />
				</Card>
			</AppShell>

		</>
	);
}
