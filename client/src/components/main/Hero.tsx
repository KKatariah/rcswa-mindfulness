import type { ReactNode } from "react";
import Image from "next/image";
import Navbar from "@/components/main/Navbar";

/** Full-width photo banner with the navbar, a heading, a line of text and optional actions. */
export default function Hero({
	title,
	subtitle,
	heightClass,
	children,
}: {
	title: string;
	subtitle: string;
	/** min-height classes, applied to both the photo and the content so they match. */
	heightClass: string;
	children?: ReactNode;
}) {
	return (
		<div className={`relative overflow-hidden ${heightClass}`}>
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
			<div className={`relative z-10 flex flex-col items-center justify-center px-6 text-center ${heightClass}`}>
				<h1 className="text-5xl font-extrabold text-white sm:text-6xl">{title}</h1>
				<p className="mt-4 max-w-xl text-lg text-white/90">{subtitle}</p>
				{children}
			</div>
		</div>
	);
}
