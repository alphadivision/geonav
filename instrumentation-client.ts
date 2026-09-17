// Dynamically imported (not a static top-level import) so the ~95KB gzip
// posthog-js chunk is never fetched/parsed/executed at all when no key is
// configured — this file runs on every single page load regardless of route,
// so a static import would ship that cost unconditionally, which is exactly
// what was happening (posthog.init was running with no key, doing nothing
// useful, on every page including the map).
if (process.env.NEXT_PUBLIC_POSTHOG_KEY) {
  import("posthog-js").then(({ default: posthog }) => {
    posthog.init(process.env.NEXT_PUBLIC_POSTHOG_KEY!, {
      api_host: "/ingest",
      ui_host: process.env.NEXT_PUBLIC_POSTHOG_HOST,
      defaults: "2025-05-24",
      capture_exceptions: true,
      debug: process.env.NODE_ENV === "development",
    });
  });
}
