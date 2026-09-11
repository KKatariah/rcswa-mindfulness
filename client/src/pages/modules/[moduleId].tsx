import Head from "next/head";
import Sidebar from "@/components/main/Sidebar";
import NextSession from "@/components/modules/NextSession";
import ModuleHeader from "@/components/modules/ModuleHeader";
import ModuleContent from "@/components/modules/ModuleContent";
import type { ContentBlock } from "@/types/module";

// Stand-in for what GET /app/modules/{moduleId}/ would return once the API exists.
const MODULE = {
	title: "Module 1 - The Body Scan",
	durationMinutes: 10,
	description: "Description of the module here",
	blocks: [
		{
			id: 1,
			type: "text",
			content: "Hello everyone",
		},
		{
			id: 2,
			type: "text",
			content:
				"Welcome to Week 1 of the WA Medical Schools Online Mindfulness Program.",
		},
		{
			id: 3,
			type: "text",
			content:
				"You should now have received an email with a link to your intake survey. If you have not yet completed these surveys, please do so now.",
		},
		{
			id: 4,
			type: "text",
			content:
				'Below is a link to the first teaching video on Multitasking and Mindfulness, plus a link to the guided mindfulness practice "Body Scan". You will also receive the link to this guided practice via SMS each week day this week at 6:30am. Don\'t forget to make a note of the days that you complete your mindfulness practice so that you can complete your weekly mindfulness feedback survey, which will be emailed to you at the end of the week.',
		},
		{
			id: 5,
			type: "video",
			title: "Multitasking and Mindfulness",
			embedUrl: "https://www.youtube.com/embed/Lc3_dVSEE_E?si=J419H99Q_QVe9thq",
		},
		{
			id: 6,
			type: "text",
			content: 'Here is the guided mindfulness practice, "The Body Scan".',
		},
		{
			id: 7,
			type: "audio",
			title: "The Body Scan",
			embedUrl:
				"https://w.soundcloud.com/player/?url=https%3A//api.soundcloud.com/tracks/soundcloud%253Atracks%253A1227212032&color=%23ff5500&auto_play=false&hide_related=false&show_comments=true&show_user=true&show_reposts=false&show_teaser=true",
			attribution: {
				artistName: "Dr Sarah Moore",
				artistUrl: "https://soundcloud.com/user-124579650",
				trackTitle: "The Body Scan",
				trackUrl: "https://soundcloud.com/user-124579650/the-body-scan",
			},
		},
		{
			id: 8,
			type: "text",
			content:
				"I would also like to remind you to consider finding a Mindfulness buddy who you can check in with during the 8-week program. With your buddy, you can discuss your learnings, share your challenges, and support one another to keep up with your practice. If you would like assistance with finding a buddy, please email me and I would be happy to help.",
		},
	] satisfies ContentBlock[],
};

// Background photo by Michael Metschl (Pexels): https://www.pexels.com/photo/18284929/

export default function ModulePage() {
	return (
		<>
			<Head>
				<title>{MODULE.title}</title>
			</Head>
			<div
				className="min-h-screen bg-cover bg-center bg-fixed bg-no-repeat p-4 lg:p-6 xl:h-dvh xl:overflow-hidden"
				style={{ backgroundImage: "url(/images/module-background.jpg)" }}
			>
				<div className="mx-auto grid max-w-[1920px] items-start gap-6 md:grid-cols-[240px_minmax(0,1fr)] xl:grid-cols-[280px_minmax(0,1fr)_320px]">
					<Sidebar responsive />
					<div
						role="region"
						aria-label="Module content"
						tabIndex={0}
						className="flex min-w-0 flex-col rounded-[10px] border border-gray-200 bg-white shadow-[0_6px_9px_rgba(0,0,0,0.05)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-blue xl:h-[calc(100dvh-3rem)] xl:overflow-y-auto xl:overscroll-contain xl:[scrollbar-width:thin] [&>*]:shrink-0"
					>
						<ModuleHeader
							embedded
							title={MODULE.title}
							durationMinutes={MODULE.durationMinutes}
							description={MODULE.description}
						/>

						<hr className="mx-6 mt-6 border-0 border-t border-gray-200 sm:mx-10 lg:mx-12" />
						<ModuleContent blocks={MODULE.blocks} embedded />
					</div>
					<div className="min-w-0 md:col-start-2 xl:col-start-3 xl:sticky xl:top-6">
						{/* Sample schedule until session data is connected. */}
						<NextSession moduleTitle="Module Week 3" startsAt="2028-10-24T10:00:00+08:00" dateLabel="Tue, Oct 24" timeLabel="10:00 AM" />
					</div>
				</div>
			</div>
		</>
	);
}
