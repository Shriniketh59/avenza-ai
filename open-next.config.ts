import { defineCloudflareConfig } from "@opennextjs/cloudflare";

// Defaults: no incremental cache is needed, every page is rendered per request (they depend on the session).
export default defineCloudflareConfig({});
