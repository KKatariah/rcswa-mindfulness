import Head from "next/head";
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
				className="min-h-screen bg-cover bg-center bg-no-repeat px-6 py-10 sm:px-10 lg:px-12"
				style={{ backgroundImage: "url(/images/module-background.jpg)" }}
			>
				<div className="mx-auto flex max-w-[1600px] gap-6">
					{" "}
					{/* IT LOOKS REALLY WEIRD AND BIG ATM BC IT WILL FILL ONCE OTHER COMPONENTS ARE IN */}
					<div className="flex flex-1 flex-col gap-6">
						<ModuleHeader
							title={MODULE.title}
							durationMinutes={MODULE.durationMinutes}
							description={MODULE.description}
						/>

						<ModuleContent blocks={MODULE.blocks} />
					</div>
				</div>
			</div>
		</>
	);
}
