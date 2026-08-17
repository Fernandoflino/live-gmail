import { useEffect, useRef, useState } from "react";

// Vite escaneia essa pasta em build time, então basta adicionar/remover
// arquivos em src/assets/audio para mudar os sons disponíveis.
const AUDIO_FILES = Object.values(
  import.meta.glob("@/assets/audio/*.{mp3,mpeg,wav,ogg,m4a,aac}", {
    eager: true,
    query: "?url",
    import: "default",
  }),
) as string[];

// "Tópico" público no ntfy.sh (serviço gratuito de notificações, sem cadastro).
// O n8n publica uma mensagem nesse tópico quando chega email novo; esta
// página fica ouvindo o mesmo tópico e toca o som ao receber.
//
// Troque por um nome único/difícil de adivinhar — qualquer pessoa que souber
// o nome do tópico consegue tocar o som aqui (não tem dado sensível exposto,
// mas evita brincadeira alheia).
const NTFY_TOPIC = "gmail-alert-fernandolino-7x9k2m";
const NTFY_SSE_URL = `https://ntfy.sh/${NTFY_TOPIC}/sse`;

export function GmailAlert() {
  const [soundOn, setSoundOn] = useState(false);
  const soundOnRef = useRef(false);
  const [connected, setConnected] = useState(false);
  const [count, setCount] = useState(0);
  const [lastMessage, setLastMessage] = useState<string | null>(null);
  const [lastAt, setLastAt] = useState<number | null>(null);
  const [flash, setFlash] = useState(false);

  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);

  function playBell() {
    if (!soundOnRef.current) return;
    if (AUDIO_FILES.length === 0) {
      console.warn("Nenhum áudio encontrado em src/assets/audio");
      return;
    }
    const url = AUDIO_FILES[Math.floor(Math.random() * AUDIO_FILES.length)];
    const audio = new Audio(url);
    audio.play().catch((e) => console.error("Erro ao tocar áudio:", e));
  }

  function toggleSound() {
    setSoundOn((v) => !v);
  }

  useEffect(() => {
    const es = new EventSource(NTFY_SSE_URL);

    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);

    es.onmessage = (ev) => {
      try {
        const data = JSON.parse(ev.data) as { event: string; message?: string };
        if (data.event === "open") {
          setConnected(true);
          return;
        }
        if (data.event !== "message") return;

        setCount((c) => c + 1);
        setLastMessage(data.message || "Novo email");
        setLastAt(Date.now());
        setFlash(true);
        setTimeout(() => setFlash(false), 1800);
        playBell();
      } catch {
        // ignora linhas que não são JSON válido (ex: comentários de keepalive)
      }
    };

    return () => es.close();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const lastAtLabel = lastAt ? new Date(lastAt).toLocaleTimeString("pt-BR") : "—";

  return (
    <div className="min-h-screen w-full flex items-center justify-center p-6">
      <div
        className={`w-full max-w-xl rounded-3xl bg-surface/60 border border-white/5 backdrop-blur p-8 sm:p-12 flex flex-col items-center text-center gap-6 relative overflow-hidden ${
          flash ? "animate-flash-new" : ""
        }`}
        style={{ boxShadow: "var(--shadow-card)" }}
      >
        <div
          className="absolute inset-0 opacity-30 pointer-events-none"
          style={{
            background:
              "radial-gradient(circle at 50% 0%, color-mix(in oklab, var(--brand) 40%, transparent), transparent 60%)",
          }}
        />

        <p className="text-xs sm:text-sm font-semibold tracking-[0.25em] sm:tracking-[0.3em] text-brand uppercase">
          Alerta de email
        </p>
        <h1 className="text-2xl sm:text-3xl font-bold text-foreground">📬 Novo email no Gmail</h1>

        <button
          onClick={toggleSound}
          className={`px-4 py-2 rounded-xl border text-sm font-semibold transition-colors ${
            soundOn
              ? "bg-brand/20 border-brand/50 text-brand"
              : "bg-surface-2/50 border-white/10 text-muted-foreground hover:text-foreground"
          }`}
          aria-label={soundOn ? "Desativar som" : "Ativar som"}
        >
          {soundOn ? "🔔 Som ligado" : "🔕 Ativar som"}
        </button>

        <div className="flex items-center gap-2">
          <span
            className={`h-2.5 w-2.5 rounded-full ${connected ? "bg-brand animate-pulse-glow" : "bg-destructive"}`}
          />
          <span className="text-xs sm:text-sm text-muted-foreground">
            {connected ? "Conectado, esperando emails…" : "Conectando…"}
          </span>
        </div>

        <div className="text-sm text-muted-foreground">
          <p>
            Emails avisados nesta sessão: <span className="font-semibold text-foreground">{count}</span>
          </p>
          <p>
            Último aviso: {lastAtLabel}
            {lastMessage ? ` — ${lastMessage}` : ""}
          </p>
        </div>

        {!soundOn && (
          <p className="text-xs text-muted-foreground max-w-sm">
            Clique em "Ativar som" — os navegadores só deixam tocar áudio depois de um clique na página.
          </p>
        )}
      </div>
    </div>
  );
}
