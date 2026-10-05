import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { defineConfig, devices } from "@playwright/test";

// The e2e run uses its own ports, database and Next build folder so it can run
// alongside the normal dev servers without touching their data.
const API_PORT = 8001;
const WEB_PORT = 3100;
const WEB_URL = `http://localhost:${WEB_PORT}`;
const VENV_PYTHON = resolve(__dirname, "../.venv/bin/python");
const PYTHON = process.env.PYTHON ?? (existsSync(VENV_PYTHON) ? VENV_PYTHON : "python3");

// One device per run. Tests consume seeded data (approvals, survey submissions), so each
// device needs its own fresh database; `npm run test:e2e:all` runs them one after another.
const DEVICES = {
	desktop: { name: "desktop-chrome", use: devices["Desktop Chrome"] },
	android: { name: "android-chrome", use: devices["Pixel 7"] },
	ios: { name: "ios-safari", use: devices["iPhone 14"] },
} as const;
const DEVICE = (process.env.E2E_DEVICE ?? "desktop") as keyof typeof DEVICES;
if (!(DEVICE in DEVICES)) {
	throw new Error(`E2E_DEVICE must be one of: ${Object.keys(DEVICES).join(", ")}`);
}

export default defineConfig({
	testDir: "./e2e",
	fullyParallel: false,
	workers: 1,
	retries: 0,
	reporter: "list",
	use: {
		baseURL: WEB_URL,
		trace: "retain-on-failure",
	},
	projects: [DEVICES[DEVICE]],
	webServer: [
		{
			// Fresh database on every run.
			command:
				`cd .. && rm -f e2e.sqlite3 && ${PYTHON} manage.py migrate --noinput -v 0 ` +
				`&& ${PYTHON} manage.py shell < client/e2e/seed.py ` +
				`&& ${PYTHON} manage.py runserver ${API_PORT} --noreload`,
			url: `http://127.0.0.1:${API_PORT}/api/program-status/`,
			env: {
				DJANGO_DB_PATH: "e2e.sqlite3",
				CORS_ALLOWED_ORIGINS: WEB_URL,
				// One run logs in more test users than the normal 10 a minute allows.
				AUTH_THROTTLE_RATE: "1000/min",
			},
			reuseExistingServer: false,
			timeout: 120_000,
		},
		{
			command: `npx next dev --port ${WEB_PORT}`,
			url: WEB_URL,
			env: {
				NEXT_DIST_DIR: ".next-e2e",
				NEXT_PUBLIC_API_BASE_URL: `http://127.0.0.1:${API_PORT}/api`,
			},
			reuseExistingServer: false,
			timeout: 180_000,
		},
	],
});
