import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Node 25+ has a built-in localStorage global that hides jsdom's; turn it off there.
// (Older Nodes, like CI's Node 20, don't know the flag.)
const nodeMajor = Number(process.versions.node.split(".")[0]);
const execArgv = nodeMajor >= 25 ? ["--no-experimental-webstorage"] : [];

// Unit tests only; the Playwright suite in e2e/ runs separately (npm run test:e2e).
export default defineConfig({
	resolve: {
		alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
	},
	test: {
		environment: "jsdom",
		execArgv,
		include: ["src/**/*.test.{ts,tsx}"],
		setupFiles: ["./vitest.setup.ts"],
		restoreMocks: true,
		unstubGlobals: true,
		coverage: {
			include: ["src/lib/**", "src/hooks/**", "src/components/**"],
		},
	},
});
