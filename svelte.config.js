import adapter from "@sveltejs/adapter-static";

const dev = process.env.NODE_ENV === "development";

// Served from a subpath: /dev/morse/ behind the dev stack, /morse/ on GH Pages.
// SvelteKit's base must not have a trailing slash; it adds the slash itself.
const base = dev ? "" : (process.env.BASE_PATH ?? "/morse").replace(/\/$/, "");

export default {
	kit: {
		adapter: adapter({
			// `dist` so `dev-deploy morse` finds it with no arguments.
			pages: "dist",
			assets: "dist",
		}),
		paths: { base },
	},
};
