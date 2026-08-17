import { createFileRoute } from "@tanstack/react-router";
import { Dashboard } from "@/components/Dashboard";

export const Route = createFileRoute("/")({
  component: Dashboard,
  head: () => ({
    meta: [
      { title: "Painel ao vivo — Inscrições do Evento" },
      {
        name: "description",
        content: "Dashboard em tempo real com total de inscritos, ranking por instituição e novos inscritos da última hora.",
      },
    ],
  }),
});
