"use client";
import Link from "next/link";
import RunLauncher from "@/components/RunLauncher";
import { useShell } from "@/components/Shell";
import { Badge } from "@/components/ui";
import { fmt } from "@/lib/api";

const STEPS = [
  ["OpenAlex", "250+ млн работ, без подписки. Статистика по всему массиву, а не по выборке."],
  ["Сети", "Коцитирование, сопряжение, соавторство. Интерактивно и в Gephi / VOSviewer."],
  ["Семантика", "Кластеры по смыслу аннотаций, подписанные LLM. Слабо представленные направления."],
  ["Проверка", "Детектор смещённой выборки и воспроизводимый эксперимент «релевантность vs случайная»."],
];

export default function Home() {
  const { runs, health, refresh } = useShell();
  const latest = runs[0];
  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-wrap items-start gap-6">
        <div className="flex-1 min-w-[280px]">
          <h1 className="text-2xl font-semibold tracking-tight leading-tight">Библиометрический анализ <span className="text-accent">с семантическим слоем</span></h1>
          <p className="text-ink-2 mt-2 leading-relaxed text-sm">
            Задайте тему — инструмент соберёт точную статистику по OpenAlex, построит сети, сгруппирует работы по смыслу
            и подпишет направления. Результат — интерактивный дашборд и готовый раздел отчёта.
          </p>
        </div>
        {latest && (
          <Link href={`/runs/${latest.id}`} className="card p-3 text-sm hover:border-accent min-w-[260px]">
            <div className="text-xs text-muted">последний прогон</div>
            <div className="font-medium mt-0.5">«{latest.query}»</div>
            <div className="text-xs text-muted mt-1">{fmt(latest.total)} работ · {latest.n_sample} в выборке {latest.has_semantic && <Badge tone="accent">семантика</Badge>}</div>
          </Link>
        )}
      </div>

      <RunLauncher health={health} onDone={refresh} />

      <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
        {STEPS.map(([t, d], i) => (
          <div key={t} className="card p-3">
            <div className="flex items-center gap-2 text-sm font-medium"><span className="w-5 h-5 rounded bg-accent text-white text-xs flex items-center justify-center">{i + 1}</span>{t}</div>
            <p className="text-xs text-ink-2 mt-1.5 leading-snug">{d}</p>
          </div>
        ))}
      </div>
      <p className="text-xs text-muted">Прогон на 2000 записей ≈ $0.025 из бесплатного дневного бюджета OpenAlex ($1). Подробнее — <Link href="/about" className="text-accent hover:underline">о методе</Link>.</p>
    </div>
  );
}
