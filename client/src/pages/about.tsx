import Head from "next/head";
import Image from "next/image";
import Navbar from "@/components/main/Navbar";
import Footer from "@/components/main/Footer";
import { LinkedinIcon, GlobeIcon } from "@/components/ui/icons";

const SARAH_EMAIL = "sarah.j.moore@rcswa.edu.au";

// Placeholder headshot — replace with the official photo once received from Sarah
const SARAH_PHOTO = "/images/sarah-moore.jpg";

const PAGE_CONTENT = {
	sarah: {
		name: "Dr Sarah Moore",
		role: "Rural GP Obstetrician & Senior Lecturer, RCSWA",
		bio: "Dr Sarah Moore is a rural GP obstetrician and senior lecturer with the Rural Clinical School of Western Australia (RCSWA), where she teaches and mentors medical students. Sarah is also the RCSWA Sub-Dean for Student Matters and Chair of the RCSWA Wellbeing Working Party. Sarah is passionate about whole person care and has undertaken training in mindfulness, integrative medicine and whole person care. Sarah has recently completed her PhD at UWA, evaluating the effects of a tailored, online mindfulness training program on the wellbeing of medical students and junior doctors. Sarah is committed to making mindfulness training accessible and relevant to medical students and junior doctors so that they can integrate mindfulness practices into their daily lives and become more present, compassionate and connected with their community.",
		linkedin: "https://www.linkedin.com/in/dr-sarah-moore-84a0902a/",
		linkedinLabel: "Sarah's LinkedIn",
		research: "https://research-repository.uwa.edu.au/en/persons/sarah-moore/",
		researchLinkText: "Read Sarah's research on UWA Research Repository",
		phdIntro: "This programme has been developed and evaluated through Sarah's PhD research at UWA.",
	},
	rcswa: {
		name: "The Rural Clinical School of Western Australia",
		description:
			"At the Rural Clinical School of Western Australia, we are passionate about teaching rural medicine, creating opportunities for students and medical professionals, and inspiring them to lead successful rural medical careers. While the challenges we face are great, we know our role is important and is making a difference in many communities. Our vision for the future is to build on our successes and foster an exceptional locally trained, research-driven, collegiate, academic and clinical community, providing equitable healthcare to rural and remote WA.",
		href: "https://www.uwa.edu.au/rcswa/about-us",
	},
};

export default function AboutPage() {
	return (
		<>
			<Head>
				<title>About Us | RCSWA Wellbeing</title>
				<meta
					name="description"
					content="Learn about Dr Sarah Moore and the Rural Clinical School of Western Australia — the team behind this mindfulness programme for medical students."
				/>
			</Head>

			{/* Hero */}
			<div className="relative min-h-[360px] overflow-hidden sm:min-h-[440px]">
				<Image
					src="/pexels-michael-metschl-718198730-18284929.jpg"
					alt=""
					fill
					priority
					sizes="100vw"
					className="object-cover"
				/>
				<div className="absolute inset-0 bg-gradient-to-b from-black/50 via-black/30 to-black/50" />
				<Navbar />
				<div className="relative z-10 flex min-h-[360px] flex-col items-center justify-center px-6 text-center sm:min-h-[440px]">
					<h1 className="text-5xl font-extrabold text-white sm:text-6xl">
						About Us
					</h1>
					<p className="mt-4 max-w-xl text-lg text-white/90">
						The mindfulness programme for medical students and junior doctors, created by Dr Sarah Moore at the Rural Clinical School of Western Australia.
					</p>
				</div>
			</div>

			{/* Dr Sarah Moore */}
			<section
				aria-labelledby="sarah-heading"
				className="bg-white px-6 py-20 sm:px-10 lg:px-30"
			>
				<div className="mx-auto max-w-5xl">
					<div className="grid gap-10 lg:grid-cols-[256px_1fr] lg:gap-16">
						<div className="flex justify-center lg:justify-start">
							{SARAH_PHOTO ? (
								<div className="relative aspect-square w-48 overflow-hidden rounded-2xl sm:w-56 lg:w-full">
									<Image
										src={SARAH_PHOTO}
										alt="Dr Sarah Moore"
										fill
										className="object-cover"
										sizes="(min-width: 1024px) 256px, (min-width: 640px) 224px, 192px"
									/>
								</div>
							) : (
								<div
									className="flex aspect-square w-48 flex-col items-center justify-center rounded-2xl border border-dashed border-gray-300 bg-surface-muted text-center sm:w-56 lg:w-full"
									role="img"
									aria-label="Photo of Dr Sarah Moore — not yet available"
								>
									<span className="px-4 text-sm font-semibold text-muted">
										Dr Sarah Moore
									</span>
									<span className="mt-1 px-4 text-xs text-muted">
										Photo not available
									</span>
								</div>
							)}
						</div>

						{/* Bio */}
						<div>
							<h2
								id="sarah-heading"
								className="text-3xl font-extrabold text-ink sm:text-4xl"
							>
								{PAGE_CONTENT.sarah.name}
							</h2>
							<p className="mt-2 text-[15px] font-semibold text-brand-blue">
								{PAGE_CONTENT.sarah.role}
							</p>
							<p className="mt-6 text-[15px] leading-relaxed text-muted">
								{PAGE_CONTENT.sarah.bio}
							</p>
							<p className="mt-4 text-[15px] leading-relaxed text-muted">
								{PAGE_CONTENT.sarah.phdIntro}{" "}
								<a
									href={PAGE_CONTENT.sarah.research}
									target="_blank"
									rel="noopener noreferrer"
									className="font-semibold text-brand-blue-dark underline underline-offset-2"
								>
									{PAGE_CONTENT.sarah.researchLinkText}
								</a>
								.
							</p>

							<div className="mt-6 flex flex-wrap items-center gap-3">
								<a
									href={PAGE_CONTENT.sarah.linkedin}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex h-10 items-center gap-2 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-ink hover:bg-surface-muted"
								>
									<LinkedinIcon className="size-4 shrink-0 text-muted" aria-hidden="true" />
									{PAGE_CONTENT.sarah.linkedinLabel}
								</a>
								<a
									href={PAGE_CONTENT.sarah.research}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex h-10 items-center gap-2 rounded-xl border border-gray-200 px-4 text-sm font-semibold text-ink hover:bg-surface-muted"
								>
									<GlobeIcon className="size-4 shrink-0 text-muted" aria-hidden="true" />
									UWA Research Repository
								</a>
								{SARAH_EMAIL ? (
									<a
										href={`mailto:${SARAH_EMAIL}`}
										className="inline-flex min-h-10 items-center gap-2 rounded-xl border border-gray-200 px-4 py-2 text-sm font-semibold text-ink hover:bg-surface-muted"
									>
										{SARAH_EMAIL}
									</a>
								) : (
									<span className="inline-flex h-10 items-center rounded-xl border border-dashed border-gray-300 px-4 text-sm italic text-muted">
										Contact email — coming soon
									</span>
								)}
							</div>
						</div>
					</div>
				</div>
			</section>

			{/* RCSWA */}
			<section
				aria-labelledby="rcswa-heading"
				className="bg-surface-muted px-6 py-20 sm:px-10 lg:px-30"
			>
				<div className="mx-auto max-w-5xl">
					<div className="grid gap-10 lg:grid-cols-[2fr_3fr] lg:gap-16 lg:items-center">
						<div>
							<h2
								id="rcswa-heading"
								className="text-3xl font-extrabold text-ink sm:text-4xl"
							>
								{PAGE_CONTENT.rcswa.name}
							</h2>
							<p className="mt-6 text-[15px] leading-relaxed text-muted">
								{PAGE_CONTENT.rcswa.description}
							</p>
							<div className="mt-8">
								<a
									href={PAGE_CONTENT.rcswa.href}
									target="_blank"
									rel="noopener noreferrer"
									className="inline-flex h-12 items-center justify-center rounded-xl bg-brand-blue px-6 text-[15px] font-bold text-white shadow-[0px_6px_8px_rgba(0,0,0,0.1)]"
								>
									About the RCSWA
								</a>
							</div>
						</div>

						{/* Source: The West Australian — RCSWA clinical training photograph */}
						<div className="relative aspect-[16/9] overflow-hidden rounded-2xl">
							<Image
								src="https://images.thewest.com.au/publication/C-17753317/e013daf310282c62ca7eee98c5e1db983668743f-16x9-x41y447w3947h2220.jpg"
								alt="A rural GP working alongside medical students in a clinical setting, representing the RCSWA's mission to train doctors for rural and remote Western Australia"
								fill
								className="object-cover"
								sizes="(min-width: 1024px) 60vw, 100vw"
							/>
						</div>
					</div>
				</div>
			</section>

			<Footer />
		</>
	);
}
