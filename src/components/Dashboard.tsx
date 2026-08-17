import { useEffect, useMemo, useRef, useState } from "react";
import { parseCSV } from "@/lib/csv";
import { AnimatedNumber } from "@/components/AnimatedNumber";

// Vite escaneia a pasta em build time. Adicione/remova arquivos em
// src/assets/audio/ — a lista é regenerada automaticamente no próximo build.
const AUDIO_FILES = Object.values(
  import.meta.glob("@/assets/audio/*.{mp3,mpeg,wav,ogg,m4a,aac}", {
    eager: true,
    query: "?url",
    import: "default",
  }),
) as string[];

const CSV_URL =
  "https://docs.google.com/spreadsheets/d/e/2PACX-1vQHRb30HrxMyjqC6gs_u4BHzI_p4Eb6p47qR-GFbpcP3dIbSE-PLzZR1_Dhvjj0I6vvhl0JeyVagbVu/pub?gid=1517934245&single=true&output=csv";

const REFRESH_MS = 60_000;
const ONE_HOUR = 60 * 60 * 1000;

interface Entry {
  institution: string;
  rowKey: string;
  /** Seconds since 00:00 (server-local, timezone-agnostic). null = inválido */
  timeOfDay: number | null;
  /** Índice de chegada no CSV (0 = primeira linha de dados) */
  order: number;
}

/**
 * Parse "HH:mm" or "HH:mm:ss" → seconds since 00:00 (0..86399).
 * Returns null if invalid. Timezone-agnostic: we treat times as a position
 * in a 24h day, then compare against the server's "now" derived from the CSV.
 */
function parseTimeOfDay(raw: string): number | null {
  if (!raw) return null;
  const s = raw.trim();
  if (!s) return null;
  const m = s.match(/^(\d{1,2}):(\d{2})(?::(\d{2}))?$/);
  if (!m) return null;
  const h = Number(m[1]);
  const mi = Number(m[2]);
  const sec = Number(m[3] ?? 0);
  if (h > 23 || mi > 59 || sec > 59) return null;
  return h * 3600 + mi * 60 + sec;
}

/** Distance in seconds going backwards from `nowSec` to `tSec` on a 24h clock. */
function secondsBefore(nowSec: number, tSec: number): number {
  const diff = nowSec - tSec;
  return diff >= 0 ? diff : diff + 86400;
}

export function Dashboard() {
  const [entries, setEntries] = useState<Entry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastUpdate, setLastUpdate] = useState<Date | null>(null);
  const [now, setNow] = useState(Date.now());
  const prevTotalRef = useRef(0);
  const [flashTotal, setFlashTotal] = useState(false);
  const [soundOn, setSoundOn] = useState(false);
  const soundOnRef = useRef(false);
  useEffect(() => {
    soundOnRef.current = soundOn;
  }, [soundOn]);
  const [refreshing, setRefreshing] = useState(false);

  // tick para "última hora" recalcular
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 15_000);
    return () => clearInterval(id);
  }, []);

  /**
   * Toca um áudio aleatório da pasta src/assets/audio.
   * O Vite escaneia a pasta em build time via import.meta.glob,
   * então basta adicionar/remover arquivos lá — o código se adapta sozinho.
   */
  function playBell(count = 1) {
    if (!soundOnRef.current) return;
    if (AUDIO_FILES.length === 0) {
      console.warn("Nenhum áudio encontrado em src/assets/audio");
      return;
    }
    const n = Math.min(count, 5);
    for (let i = 0; i < n; i++) {
      setTimeout(() => {
        const url = AUDIO_FILES[Math.floor(Math.random() * AUDIO_FILES.length)];
        const audio = new Audio(url);
        audio.play().catch((e) => console.error("Erro ao tocar áudio:", e));
      }, i * 200);
    }
  }

  function toggleSound() {
    setSoundOn((v) => !v);
  }

  async function fetchData() {
    setRefreshing(true);
    try {
      // Cache-busting via query param único (sem headers extras p/ evitar preflight CORS)
      const url = `${CSV_URL}&_=${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const res = await fetch(url, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const text = await res.text();
      const rows = parseCSV(text);
      if (rows.length === 0) throw new Error("CSV vazio");

      const dataRows = rows.slice(1).filter((r) => r.some((c) => c && c.trim() !== ""));
      const built: Entry[] = [];
      const counters: Record<string, number> = {};

      for (let i = 0; i < dataRows.length; i++) {
        const row = dataRows[i];
        const raw = (row[0] || "").trim();
        const inst = raw === "" ? "Outros" : raw;
        const tod = parseTimeOfDay((row[1] || "").trim());
        counters[inst] = (counters[inst] || 0) + 1;
        const rowKey = `${inst}#${counters[inst]}`;
        built.push({ institution: inst, rowKey, timeOfDay: tod, order: i });
      }

      setEntries(() => {
        const diff = built.length - prevTotalRef.current;
        if (diff > 0 && prevTotalRef.current > 0) {
          setFlashTotal(true);
          setTimeout(() => setFlashTotal(false), 1800);
          if (soundOnRef.current) playBell(diff);
        }
        prevTotalRef.current = built.length;
        return built;
      });
      setLastUpdate(new Date());
      setError(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Erro ao carregar");
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }

  useEffect(() => {
    fetchData();
    const id = setInterval(fetchData, REFRESH_MS);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const total = entries.length;

  // "Now" do servidor = horário da ÚLTIMA linha do CSV (mais recente cronologicamente).
  // Não usamos max() porque os horários são "hora do dia" — uma linha antiga das 22:00
  // seria considerada "mais nova" que uma linha recente das 08:00.
  // Fallback para o relógio local se não houver nenhum timestamp válido.
  const serverNowSec = useMemo(() => {
    for (let i = entries.length - 1; i >= 0; i--) {
      if (entries[i].timeOfDay !== null) return entries[i].timeOfDay!;
    }
    const d = new Date();
    return d.getHours() * 3600 + d.getMinutes() * 60 + d.getSeconds();
  }, [entries]);

  // Conta inscritos da última hora percorrendo do fim para o começo do CSV.
  // Para no primeiro registro cuja diferença real ultrapassa 1h — assim
  // evitamos o "wrap" de 24h do secondsBefore() pegar linhas antigas.
  const lastHour = useMemo(() => {
    let count = 0;
    for (let i = entries.length - 1; i >= 0; i--) {
      const t = entries[i].timeOfDay;
      if (t === null) continue;
      const diff = serverNowSec - t;
      // diff negativo = horário "no futuro" em relação ao now → pula (provável ruído)
      if (diff < 0) continue;
      if (diff > 3600) break;
      count++;
    }
    return count;
  }, [entries, serverNowSec]);

  const ranking = useMemo(() => {
    const map = new Map<string, number>();
    for (const e of entries) map.set(e.institution, (map.get(e.institution) || 0) + 1);
    return Array.from(map.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => b.count - a.count);
  }, [entries]);

  const recent = useMemo(
    () =>
      entries
        .slice()
        .sort((a, b) => b.order - a.order)
        .slice(0, 8)
        .map((e) => ({
          ...e,
          ago: e.timeOfDay !== null ? secondsBefore(serverNowSec, e.timeOfDay) : null,
        })),
    [entries, serverNowSec],
  );

  return (
    <div className="min-h-screen w-full p-3 sm:p-6 lg:p-10">
      {/* 16:9 container no desktop, fluido/empilhado no mobile */}
      <div className="mx-auto w-full max-w-[1920px] grid gap-3 sm:gap-5 grid-cols-1 md:grid-cols-12 md:grid-rows-6 md:aspect-video">
        {/* Header */}
        <header className="md:col-span-12 md:row-span-1 flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
          <div>
            <p className="text-xs sm:text-sm font-semibold tracking-[0.25em] sm:tracking-[0.3em] text-brand uppercase">
              Painel ao vivo
            </p>
            <h1 className="text-xl sm:text-2xl lg:text-4xl font-bold text-foreground">Inscrições do SECOP 2026</h1>
          </div>
          <div className="flex items-center gap-3 sm:gap-4 flex-wrap">
            <button
              onClick={toggleSound}
              className={`px-3 py-1.5 sm:px-4 sm:py-2 rounded-xl border text-xs sm:text-sm font-semibold transition-colors ${
                soundOn
                  ? "bg-brand/20 border-brand/50 text-brand"
                  : "bg-surface-2/50 border-white/10 text-muted-foreground hover:text-foreground"
              }`}
              aria-label={soundOn ? "Desativar som" : "Ativar som"}
            >
              {soundOn ? "🔔 Som ligado" : "🔕 Ativar som"}
            </button>
            <div className="text-left sm:text-right">
              <div className="flex items-center gap-2 sm:justify-end">
                <span
                  className={`h-2.5 w-2.5 rounded-full ${error ? "bg-destructive" : "bg-brand animate-pulse-glow"}`}
                />
                <span className="text-xs sm:text-sm text-muted-foreground">
                  {error ? "Erro de conexão" : "Atualizando a cada 1 min"}
                </span>
              </div>
              <p className="text-[10px] sm:text-xs text-muted-foreground mt-1 flex items-center gap-1.5 sm:justify-end">
                {refreshing && (
                  <span
                    className="inline-block h-2.5 w-2.5 rounded-full border border-brand/40 border-t-brand animate-spin"
                    aria-label="Atualizando"
                  />
                )}
                <span>{lastUpdate ? `Última atualização: ${lastUpdate.toLocaleTimeString("pt-BR")}` : "—"}</span>
              </p>
            </div>
          </div>
        </header>

        {/* Counter principal */}
        <section
          className={`md:col-span-7 md:row-span-3 rounded-2xl sm:rounded-3xl bg-surface/60 border border-white/5 backdrop-blur p-6 sm:p-10 flex flex-col justify-center items-center text-center relative overflow-hidden ${
            flashTotal ? "animate-flash-new" : ""
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
          <p className="text-xs sm:text-sm lg:text-base tracking-[0.3em] sm:tracking-[0.4em] text-muted-foreground uppercase mb-2 sm:mb-4">
            Total de
          </p>
          <h2
            className="font-bold tracking-tight bg-clip-text text-transparent leading-none text-7xl sm:text-8xl md:text-[10rem] lg:text-[14rem] xl:text-[18rem]"
            style={{ backgroundImage: "var(--gradient-counter)" }}
          >
            <AnimatedNumber value={total} />
          </h2>
          <p className="text-lg sm:text-2xl lg:text-4xl font-semibold tracking-[0.2em] sm:tracking-[0.3em] text-foreground mt-3 sm:mt-4">
            INSCRITOS
          </p>
        </section>

        {/* Última hora */}
        <section
          className="md:col-span-5 md:row-span-3 rounded-2xl sm:rounded-3xl border border-brand/30 p-5 sm:p-8 flex flex-col justify-center items-center text-center relative overflow-hidden"
          style={{
            background:
              "linear-gradient(135deg, color-mix(in oklab, var(--brand) 25%, var(--surface)), var(--surface))",
            boxShadow: "var(--shadow-glow)",
          }}
        >
          <p className="text-xs sm:text-sm tracking-[0.25em] sm:tracking-[0.3em] uppercase text-brand font-semibold mb-2 sm:mb-3">
            ⏱ Última hora
          </p>
          <div className="text-6xl sm:text-7xl lg:text-8xl xl:text-9xl font-bold text-brand leading-none">
            +<AnimatedNumber value={lastHour} duration={900} />
          </div>
          <p className="text-base sm:text-lg lg:text-2xl text-foreground/80 mt-3 sm:mt-4 font-medium">
            novos inscritos nos últimos 60 min
          </p>
        </section>

        {/* Ranking */}
        <section
          className="md:col-span-7 md:row-span-2 rounded-2xl sm:rounded-3xl bg-surface/60 border border-white/5 p-4 sm:p-6 lg:p-8 flex flex-col overflow-hidden"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <div className="flex items-baseline justify-between mb-3 gap-2">
            <h3 className="text-base sm:text-xl lg:text-2xl font-bold tracking-wide">🏆 Ranking por Instituição</h3>
            <span className="text-[10px] sm:text-xs text-muted-foreground whitespace-nowrap">
              {ranking.length} instituições
            </span>
          </div>
          <ol className="flex-1 min-h-0 grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-1.5 content-start overflow-y-auto pr-1 custom-scroll">
            {ranking.map((item, i) => {
              const pos = i + 1;
              const medalColor =
                pos === 1
                  ? "text-gold"
                  : pos === 2
                    ? "text-silver"
                    : pos === 3
                      ? "text-bronze"
                      : "text-muted-foreground";
              const medalBg =
                pos === 1
                  ? "bg-gold/15 border-gold/40"
                  : pos === 2
                    ? "bg-silver/10 border-silver/30"
                    : pos === 3
                      ? "bg-bronze/15 border-bronze/40"
                      : "bg-surface-2/50 border-white/5";
              return (
                <li
                  key={item.name}
                  className={`flex items-center justify-between gap-3 px-3 py-2 rounded-xl border ${medalBg} animate-slide-in`}
                >
                  <div className="flex items-center gap-3 min-w-0">
                    <span className={`text-xl font-bold w-7 text-center ${medalColor}`}>{pos}º</span>
                    <span className="font-semibold truncate text-base lg:text-lg">{item.name}</span>
                  </div>
                  <span className="font-bold text-lg lg:text-xl tabular-nums">{item.count}</span>
                </li>
              );
            })}
          </ol>
        </section>

        {/* Últimos inscritos */}
        <section
          className="md:col-span-5 md:row-span-2 rounded-2xl sm:rounded-3xl bg-surface/60 border border-white/5 p-4 sm:p-6 lg:p-8 flex flex-col overflow-hidden"
          style={{ boxShadow: "var(--shadow-card)" }}
        >
          <div className="flex items-baseline justify-between mb-3">
            <h3 className="text-base sm:text-xl lg:text-2xl font-bold tracking-wide">🆕 Últimos inscritos</h3>
            <span className="text-[10px] sm:text-xs text-muted-foreground">por horário</span>
          </div>
          <ul className="flex-1 space-y-1.5 md:overflow-hidden">
            {recent.length === 0 && (
              <li className="text-muted-foreground text-sm italic mt-4">Aguardando novas inscrições…</li>
            )}
            {recent.map((e) => {
              const mins = e.ago !== null ? Math.floor(e.ago / 60) : null;
              const label =
                mins === null
                  ? "—"
                  : mins < 1
                    ? "agora"
                    : mins < 60
                      ? `há ${mins} min`
                      : `há ${Math.floor(mins / 60)} h`;
              return (
                <li
                  key={e.rowKey}
                  className="flex items-center justify-between gap-3 px-3 py-2 rounded-xl bg-surface-2/40 border border-white/5 animate-slide-in"
                >
                  <span className="font-semibold truncate">{e.institution}</span>
                  <span className="text-xs text-brand font-semibold whitespace-nowrap">{label}</span>
                </li>
              );
            })}
          </ul>
        </section>
      </div>

      {loading && (
        <div className="fixed inset-0 flex items-center justify-center bg-background/80 backdrop-blur z-50">
          <p className="text-brand text-xl font-semibold animate-pulse">Carregando dados…</p>
        </div>
      )}
    </div>
  );
}
