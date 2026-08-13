import Head from "next/head";
import Navbar from "@/components/main/Navbar";

export default function Home() {
	return (
		<>
			<Head>
				<title>Wellbeing Course</title>
				<meta
					name="description"
					content="An 8-week guided meditation journey"
				/>
			</Head>
			<div className="relative min-h-screen bg-ink">
				<Navbar />
			</div>
		</>
	);
}
