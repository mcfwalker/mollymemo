import { serve } from "inngest/next";
import { inngest } from "@/inngest/client";
import { functions } from "@/inngest/functions";

// Create the Inngest serve handler
export const { GET, POST, PUT } = serve({
  client: inngest,
  functions,
});
