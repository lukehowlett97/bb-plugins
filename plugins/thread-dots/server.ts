// bb-plugin-thread-dots — backend entry. Only declares settings; all the
// work happens in app.tsx.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export default async function plugin(bb: BbPluginApi) {
  bb.settings.define({
    cacheTtlMinutes: {
      type: "number",
      // Claude's prompt cache lives 5 minutes by default, 60 with the extended TTL.
      label: "Cache TTL (minutes) — how long after a turn a thread stays cache-hot",
      experimental_schema: z.number().int().min(1).max(24 * 60),
      default: 60,
    },
  });
}
