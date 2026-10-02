import { Html, Head, Main, NextScript } from "next/document";

export default function Document() {
	return (
		<Html lang="en">
			<Head>
				{/* Web app manifest — enables "Add to Home Screen" and iOS push */}
				<link rel="manifest" href="/manifest.json" />

				{/* Favicon — replace /icons/favicon-32.png with the real logo once available */}
				<link rel="icon" type="image/png" sizes="32x32" href="/icons/favicon-32.png" />

				{/* iOS home-screen icon — replace once real logo is available */}
				<link rel="apple-touch-icon" href="/icons/apple-touch-icon.png" />

				{/* iOS standalone mode */}
				<meta name="apple-mobile-web-app-capable" content="yes" />
				<meta name="apple-mobile-web-app-title" content="Wellbeing Course" />
				<meta name="apple-mobile-web-app-status-bar-style" content="default" />

				{/* Android standalone mode */}
				<meta name="mobile-web-app-capable" content="yes" />

				{/* Browser chrome colour (Android, desktop) */}
				<meta name="theme-color" content="#5096cf" />
			</Head>
			<body>
				<Main />
				<NextScript />
			</body>
		</Html>
	);
}
