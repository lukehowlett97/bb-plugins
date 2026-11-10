// bb-plugin-thread-days — backend entry. Only declares settings; all the
// work happens in app.tsx.
import type { BbPluginApi } from "@get-bb/plugin-sdk";
import { z } from "zod";

export default async function plugin(bb: BbPluginApi) {
  bb.settings.define({
    limit: {
      type: "number",
      label: "Threads shown before See more",
      experimental_schema: z.number().int().min(1).max(500),
      default: 10,
    },
  });
}
