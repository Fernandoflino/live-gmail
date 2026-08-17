import { createFileRoute } from "@tanstack/react-router";
import { GmailAlert } from "@/components/GmailAlert";

export const Route = createFileRoute("/")({
  component: GmailAlert,
  head: () => ({
    meta: [
      { title: "Alerta de email — Gmail" },
      {
        name: "description",
        content: "Toca um som sempre que chega um email novo no Gmail (via n8n).",
      },
    ],
  }),
});
