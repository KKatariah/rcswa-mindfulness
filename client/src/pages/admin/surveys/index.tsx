import { useEffect, useState } from "react";
import Head from "next/head";
import { useRouter } from "next/router";
import AdminLayout from "@/components/admin/AdminLayout";
import { listSurveysAdmin } from "@/lib/api";
import type { AdminSurvey } from "@/types/admin";

export default function AdminSurveysPage() {
	const router = useRouter();
	const [surveys, setSurveys] = useState<AdminSurvey[]>([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState<string | null>(null);

	useEffect(() => {
		let cancelled = false;
		const token = localStorage.getItem("token") ?? "";
		(async () => {
			try {
				const data = await listSurveysAdmin(token);
				if (!cancelled) setSurveys(data);
			} catch (e) {
				if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load surveys");
			} finally {
				if (!cancelled) setLoading(false);
			}
		})();
		return () => { cancelled = true; };
	}, []);

	return (
		<AdminLayout>
			<Head>
				<title>Surveys — Admin</title>
			</Head>

			<div className="flex items-center justify-between">
				<h1 className="text-2xl font-extrabold text-ink">Surveys</h1>
			</div>

			<div className="mt-6 overflow-x-auto rounded-2xl border border-gray-200 bg-white">
				{loading ? (
					<div className="flex justify-center py-16">
						<span className="text-sm text-muted">Loading…</span>
					</div>
				) : error ? (
					<p className="p-6 text-sm text-red-600">{error}</p>
				) : surveys.length === 0 ? (
					<p className="p-6 text-sm text-muted">No surveys found.</p>
				) : (
					<table className="w-full text-left text-sm">
						<thead>
							<tr className="border-b border-gray-200 text-xs font-semibold uppercase tracking-wide text-muted">
								<th className="px-5 py-3">Week</th>
								<th className="px-5 py-3">Title</th>
								<th className="px-5 py-3">Type</th>
								<th className="px-5 py-3">Questions</th>
								<th className="px-5 py-3">Responses</th>
							</tr>
						</thead>
						<tbody>
							{surveys.map((s) => (
								<tr
									key={s.id}
									onClick={() => router.push(`/admin/surveys/${s.id}`)}
									className="cursor-pointer border-b border-gray-100 last:border-0 hover:bg-surface-muted"
								>
									<td className="px-5 py-3 font-semibold text-ink">
										{s.module_week_number != null ? `Week ${s.module_week_number}` : "—"}
									</td>
									<td className="px-5 py-3 text-ink-soft">{s.title}</td>
									<td className="px-5 py-3">
										<span className="rounded-full bg-gray-100 px-2.5 py-0.5 text-xs font-semibold text-gray-600">
											{s.code}
										</span>
									</td>
									<td className="px-5 py-3 text-ink-soft">{s.question_count}</td>
									<td className="px-5 py-3 text-ink-soft">{s.response_count}</td>
								</tr>
							))}
						</tbody>
					</table>
				)}
			</div>
		</AdminLayout>
	);
}
