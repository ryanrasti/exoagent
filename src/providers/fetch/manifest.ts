/** Fetch provider — ring0 for globalThis.fetch and URL. */
export default {
	ring0: async () => ({ fetch: globalThis.fetch, URL: globalThis.URL }),
}
