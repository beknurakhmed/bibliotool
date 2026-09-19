# bibliotool — библиометрический анализ с семантическим слоем

Монорепозиторий проектной работы «Bibliometric Analysis as a Method of Scientific Research»
(Scientific Research Methodology, Bucheon University in Tashkent). Автор: Ахмедов Бекнур.

Работает на открытой базе **OpenAlex** (без подписки), выполняет классический библиометрический
анализ и дополняет его **семантическим слоем**: группирует публикации по смыслу аннотаций,
а не по совпадению ключевых слов, подписывает кластеры языковой моделью и выявляет слабо
представленные направления.

```
bibliotool/
├─ packages/core/        ядро — Python-пакет `bibliotool` (+ тесты)
│   └─ bibliotool/       openalex · data · stats · networks · semantic · llm · report · cli
├─ apps/api/             REST API (FastAPI)              → :8000  /docs
├─ apps/web/             веб-интерфейс (Next.js 16)      → :3000
├─ apps/streamlit/       лёгкий UI (Streamlit)           → :8501
├─ data/                 runs/ (результаты) · cache/ (ответы API) · logs/   [gitignored]
├─ ecosystem.config.js   pm2: все три сервиса
└─ .env                  ключи и настройки               [gitignored]
```

## Быстрый старт

```bash
cp .env.example .env            # вписать OPENALEX_API_KEY (бесплатно: openalex.org/settings/api)
npm run setup                   # pip install -r requirements.txt + pip install -e packages/core + npm install
npm run build                   # сборка Next.js
npm start                       # pm2 start ecosystem.config.js
```

| Сервис | URL | Что там |
|---|---|---|
| Web | http://localhost:3000 | запуск прогонов с живым логом, дашборд: динамика, география, источники, интерактивные сети, семантическая карта, кластеры, слабо представленные направления, методы/инструменты, эксперимент «смещение выборки», LLM-ассистент по результатам, таблица работ, файлы |
| API | http://localhost:8000/docs | OpenAPI; `/api/runs`, `/api/jobs`, `/api/runs/{id}/points`, `/network/{kind}`, `/bias`, `/ask`, `/files/…` |
| Streamlit | http://localhost:8501 | тот же анализ в одностраничном виде |

`pm2 status` · `pm2 logs` · `npm stop` · `npm run restart`. Логи — `data/logs/`.
Чтобы pm2 поднимал сервисы после перезагрузки Windows: `pm2 save` + пакет `pm2-windows-startup`.

Без pm2: `npm run dev:api` и `npm run dev:web` в двух терминалах.

## CLI (ядро без сервисов)

```bash
python -m bibliotool run "bibliometric analysis" --from 2015 --to 2026 --mode sample --limit 2000 --semantic --llm
python -m bibliotool semantic data/runs/bibliometric_analysis_2015_2026_sample --llm
python -m bibliotool report   data/runs/bibliometric_analysis_2015_2026_sample
```

Режимы выборки: `sample` (случайная, seed — репрезентативна), `recent` (по дате),
`relevance` (**смещённая**, оставлена только для демонстрации эффекта §5.1).

## Что делает

| Этап | Что считается | Как |
|---|---|---|
| Статистика | публикации по годам, страны, организации, источники, языки, типы, OA | `group_by` по **всему** массиву — точные счётчики по 100k+ работ за 1 запрос на поле |
| Выборка | 2000 записей с аннотациями и списками литературы | `sample` / `recent`; детектор смещения: 0 % нецитируемых = выборка смещена |
| Сети | соавторство, коцитирование, библиографическое сопряжение | networkx → GEXF (Gephi), CSV, map/network (VOSviewer); в UI — force-graph |
| Семантика | эмбеддинги → UMAP → HDBSCAN (выбросы к ближайшему кластеру) → c-TF-IDF → описание LLM → слабо представленные направления | sentence-transformers (мультиязычная), Ollama `qwen2.5:7b` локально или Claude |
| Методы | тип исследования, базы данных, инструменты в аннотациях | эвристика по ключевым фразам (ограничение: нестабильна) |
| Эксперимент §5.1 | релевантность vs случайная vs весь массив | одна кнопка в UI, ≈ $0.005 |
| Ассистент | вопросы к результатам («обоснуй актуальность», «какие ограничения указать») | LLM с контекстом только из данных прогона |

Стоимость: прогон на 2000 записей ≈ $0.025 из бесплатного бюджета $1/день; ответы API кешируются в `data/cache/`.

## Конфигурация (.env)

```
OPENALEX_API_KEY=...            обязательно
OPENALEX_MAILTO=you@example.com
LLM_PROVIDER=ollama             ollama | anthropic
OLLAMA_MODEL=qwen2.5:7b
ANTHROPIC_API_KEY=              если LLM_PROVIDER=anthropic (модель claude-opus-5)
EMBED_MODEL=paraphrase-multilingual-MiniLM-L12-v2
```

## Методологические замечания, встроенные в инструмент

- **Смещение выборки.** Сортировка по релевантности отбирает старые цитируемые работы и показывает ложный «спад».
  По умолчанию не используется; UI предупреждает, если в выборке нет нецитируемых работ (§5.1).
- **Сети и выборка.** При случайной выборке сеть соавторства распадается: для сетевого анализа нужна сплошная
  выгрузка по узкой теме (§5.4).
- **«Слабо представленные направления»** — области с малым числом публикаций *в данной базе и выборке*,
  а не пробелы в науке (§6.2).
- **Языковой охват.** Неанглоязычная (в т. ч. узбекская) наука в OpenAlex недопредставлена (§5.5).

## Тесты

```bash
npm test          # pytest packages/core/tests — офлайн-тесты ядра + AppTest интерфейса
```
