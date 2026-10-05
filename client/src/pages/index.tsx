import { useRef, useState } from "react";
import Head from "next/head";
import Link from "next/link";
import Hero from "@/components/main/Hero";
import Footer from "@/components/main/Footer";
import SignUpModal from "@/components/main/SignUpModal";
import { useAuth } from "@/context/AuthContext";
import { useAsync } from "@/hooks/useAsync";
import { listModuleSummaries, type ApiModuleSummary } from "@/lib/api";
import {
	CalendarIcon,
	ChevronLeftIcon,
	ChevronRightIcon,
	HeadphonesIcon,
	UsersIcon,
} from "@/components/ui/icons";

const HOW_IT_WORKS = [
	{
		icon: CalendarIcon,
		title: "Week-by-week structure",
		description:
			"One module per week, with guided sessions and clear goals to keep you on track.",
	},
	{
		icon: HeadphonesIcon,
		title: "Guided meditations",
		description:
			"Gentle, expert-led sessions that help you focus, breathe, and settle into calm.",
	},
	{
		icon: UsersIcon,
		title: "Community support",
		description:
			"Join a supportive community and stay motivated with progress tracking and encouragement.",
	},
];

const CARD_SCROLL_DISTANCE = 320;
const CTA_CLASS =
	"items-center justify-center rounded-xl bg-brand-blue px-8 text-[15px] font-bold text-white shadow-[0px_6px_8px_rgba(0,0,0,0.1)]";

function ScrollButtons({ onScroll, className }: { onScroll: (direction: number) => void; className: string }) {
	const buttonClass =
		"flex size-10 items-center justify-center rounded-full border border-gray-200 bg-white text-ink hover:bg-surface-muted";
	return (
		<div className={`items-center gap-3 ${className}`}>
			<button type="button" onClick={() => onScroll(-1)} aria-label="Scroll to previous weeks" className={buttonClass}>
				<ChevronLeftIcon className="size-5" />
			</button>
			<button type="button" onClick={() => onScroll(1)} aria-label="Scroll to next weeks" className={buttonClass}>
				<ChevronRightIcon className="size-5" />
			</button>
		</div>
	);
}

export default function Home() {
	const { user } = useAuth();
	const weeksRef = useRef<HTMLDivElement>(null);
	const [signUpOpen, setSignUpOpen] = useState(false);
	const {
		data: programmeWeeks,
		loading: weeksLoading,
		error: weeksError,
	} = useAsync(
		() =>
			listModuleSummaries().then(
				// Week 0 is the introduction module, not one of the 8 programme weeks.
				(modules) => modules.filter((m) => m.week_number > 0),
				() => {
					throw new Error("Unable to load the programme right now.");
				},
			),
		[],
		[] as ApiModuleSummary[],
	);

	function scrollWeeks(direction: number) {
		weeksRef.current?.scrollBy({ left: direction * CARD_SCROLL_DISTANCE, behavior: "smooth" });
	}

	return (
		<>
			<Head>
				<title>Wellbeing Course</title>
				<meta
					name="description"
					content="An 8-week guided meditation journey"
				/>
			</Head>

			<Hero
				title="Find Your Calm"
				subtitle="An 8-week guided meditation journey for lasting wellbeing"
				heightClass="min-h-[560px] sm:min-h-[640px]"
			>
				{user ? (
					<Link href="/modules" className={`mt-8 flex h-14 ${CTA_CLASS}`}>
						Continue Your Journey
					</Link>
				) : (
					<button
						type="button"
						onClick={() => setSignUpOpen(true)}
						className={`mt-8 flex h-14 ${CTA_CLASS}`}
					>
						Start Your Journey
					</button>
				)}
			</Hero>

			<section className="bg-white px-6 py-20 sm:px-10 lg:px-30">
				<div className="mx-auto max-w-2xl text-center">
					<h2 className="text-3xl font-extrabold text-ink sm:text-4xl">How It Works</h2>
					<p className="mt-4 text-[15px] text-muted">
						A structured path with guided sessions, weekly focus, and community
						support-designed to help you build a consistent practice.
					</p>
				</div>

				<div className="mx-auto mt-12 grid max-w-5xl gap-6 sm:grid-cols-2 lg:grid-cols-3">
					{HOW_IT_WORKS.map(({ icon: Icon, title, description }) => (
						<div
							key={title}
							className="rounded-2xl border border-gray-200 p-6"
						>
							<div className="flex size-10 items-center justify-center rounded-xl bg-brand-blue text-white">
								<Icon className="size-5" />
							</div>
							<h3 className="mt-4 font-bold text-ink">{title}</h3>
							<p className="mt-2 text-sm text-muted">{description}</p>
						</div>
					))}
				</div>
			</section>

			<section className="bg-surface-muted px-6 py-20 sm:px-10 lg:px-30">
				<div className="mx-auto flex max-w-6xl items-center justify-between gap-4">
					<h2 className="text-3xl font-extrabold text-ink sm:text-4xl">
						The 8-Week Programme
					</h2>

					<ScrollButtons onScroll={scrollWeeks} className="hidden shrink-0 sm:flex" />
				</div>

				{weeksError ? (
					<p className="mx-auto mt-12 max-w-6xl text-center text-sm text-muted">{weeksError}</p>
				) : (
					<div
						ref={weeksRef}
						className="mx-auto mt-12 flex max-w-6xl snap-x snap-mandatory gap-6 overflow-x-auto scrollbar-none pb-4"
					>
						{weeksLoading
							? Array.from({ length: 4 }).map((_, index) => (
									<div
										key={index}
										className="h-44 w-72 shrink-0 animate-pulse rounded-2xl bg-white p-6 sm:w-80"
									/>
								))
							: programmeWeeks.map(({ id, week_number, title, summary }) => (
									<div
										key={id}
										className="flex w-72 shrink-0 flex-col snap-start rounded-2xl bg-white p-6 sm:w-80"
									>
										<span className="inline-flex w-fit items-center rounded-full bg-brand-blue/10 px-3 py-1 text-xs font-bold uppercase tracking-wide text-brand-blue">
											Week {week_number}
										</span>
										<h3 className="mt-4 line-clamp-2 min-h-12 font-bold text-ink">{title}</h3>
										<p className="mt-3 line-clamp-3 min-h-16 border-t border-gray-100 pt-3 text-sm text-muted">
											{summary}
										</p>
									</div>
								))}
					</div>
				)}

				<ScrollButtons onScroll={scrollWeeks} className="mt-2 flex justify-center sm:hidden" />
			</section>

			<section className="bg-white px-6 py-20 text-center sm:px-10 lg:px-30">
				{user ? (
					<>
						<h2 className="text-3xl font-extrabold text-ink sm:text-4xl">Ready for Your Next Session?</h2>
						<p className="mt-4 text-[15px] text-muted">Pick up where you left off in the programme.</p>
						<Link href="/modules" className={`mt-8 inline-flex h-14 ${CTA_CLASS}`}>
							Go to Programme
						</Link>
					</>
				) : (
					<>
						<h2 className="text-3xl font-extrabold text-ink sm:text-4xl">Ready to Begin?</h2>
						<p className="mt-4 text-[15px] text-muted">Join others on the path to wellbeing.</p>
						<button
							type="button"
							onClick={() => setSignUpOpen(true)}
							className={`mt-8 inline-flex h-14 ${CTA_CLASS}`}
						>
							Sign Up Free
						</button>
					</>
				)}
			</section>

			<Footer />

			<SignUpModal isOpen={signUpOpen} onClose={() => setSignUpOpen(false)} />
		</>
	);
}
