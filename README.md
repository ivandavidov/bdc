# BDC Радар

Статичен сайт на български, който оценява борсово търгуваните **Business Development Companies (BDC)** в САЩ по едни и същи правила:

- дивидентна устойчивост;
- стабилност на NAV;
- кредитно качество;
- ливъридж;
- разходи.

Всяка компания получава скор 0–100 и светофар, отделно от оценката на цената (P/NAV).

Сайтът е в `docs/` и се публикува с GitHub Pages. Данните се обновяват автоматично от GitHub Actions всеки делничен ден.

> Това не е инвестиционен съвет. Изчисленията са автоматични и може да съдържат грешки.

## Какво има в сайта

| Страница | Съдържание |
|---|---|
| `index.html` — Табло | Обобщение на сектора, таблица с всички BDC (сортиране, филтри, групи колони), ★ списък за наблюдение, отметки за сравнение, графика „Качество спрямо P/NAV“, последни промени |
| `company.html?t=ARCC` — Профил | Скор и разбивка, червени флагове, ключови метрики с персентили, графики (цена/NAV, P/NAV, NII срещу дивидент, покритие, икономическа доходност, non-accruals, ливъридж, PIK), портфейл, дивиденти, такси, отчети в SEC |
| `compare.html` | До 4 компании една до друга + наслагнати графики |
| `sector.html` | Секторни медиани във времето, здраве на портфейлите (обезценки, non-accruals, PIK, общи проблемни кредитополучатели) и класации |
| `changes.html` + `feed.xml` | Дневник на важните промени и RSS |
| `methodology.html`, `learn.html`, `glossary.html` | Методология, „Какво е BDC“, речник |

## Откъде идват данните

- **Списък с компании:** SEC BDC Data Sets (всички BDC с XBRL отчети) ∩ файлът на SEC с тикери на NYSE/Nasdaq → `config/universe.yaml`.
- **Финансови данни:** SEC XBRL API (`data.sec.gov/api/xbrl/companyfacts`). Таговете по метрика са в `config/xbrl_tags.yaml`.
- **Портфейл и non-accruals:** Schedule of Investments от XBRL на всеки 10-Q/10-K чрез [edgartools](https://github.com/dgunning/edgartools). Типовете инвестиции се групират по `config/investment_types.yaml`.
- **Цени и дивиденти:** Yahoo Finance чрез `yfinance`.

## Структура

```
docs/                 сайтът (GitHub Pages)
  assets/css, assets/js
  data/               генерирани JSON файлове (summary, sector, meta, events, companies/<TICKER>.json)
pipeline/             Python код, който събира и изчислява данните
  sec.py universe.py facts.py prices.py dividends.py metrics.py portfolio.py scoring.py events.py build.py
config/               ръчни настройки: списък с компании, XBRL тагове, методология на скора, типове инвестиции
tests/                pytest
.github/workflows/    автоматичното обновяване
```

## Локално пускане

Нужен е Python 3.10+ (edgartools не работи с 3.9). С [uv](https://github.com/astral-sh/uv):

```bash
brew install uv
```

```bash
uv venv -p 3.12 .venv && uv pip install -p .venv -r requirements.txt
```

SEC изисква контакт в User-Agent:

```bash
export SEC_USER_AGENT="bdc-radar your@email.com"
```

Изграждане на данните. Първият път отнема ~20–30 минути заради портфейлите; след това се кешира в `data_cache/`:

```bash
.venv/bin/python -m pipeline.build
```

Преглед на сайта:

```bash
python3 -m http.server 8000 --directory docs
```

Тестове:

```bash
.venv/bin/python -m pytest -q
```

Полезни опции на `pipeline.build`:

- `--skip-universe` — не обновява списъка с компании;
- `--only ARCC MAIN` — само тези тикери, за отстраняване на грешки;
- `--portfolio-history 8` — за колко последни отчета да се изчисли историята на non-accruals (по подразбиране 4).

## Публикуване в GitHub

1. Създайте празно хранилище в GitHub (например `bdc`).
2. Свържете го и качете кода:

   ```bash
   git remote add origin https://github.com/<потребител>/bdc.git
   ```

   ```bash
   git push -u origin main
   ```

3. **Settings → Pages → Build and deployment:** Source = *Deploy from a branch*, Branch = `main`, папка `/docs`.
4. **Settings → Secrets and variables → Actions:**
   - Secret `SEC_USER_AGENT` = `bdc-radar your@email.com`;
   - по желание Variable `SITE_URL` = адресът на сайта, ако не е стандартният `https://<потребител>.github.io/<repo>/` (ползва се за RSS линковете).
5. **Actions → „Обновяване на данните“ → Run workflow** — първото пускане. След това върви автоматично в 22:30 UTC в делнични дни и commit-ва новите данни.

## Настройки

- **`config/universe.yaml`** — допълва се автоматично. Ръчно може да се зададат `manager`, `managed: internal|external`, `exclude: true` (за изключване на компания) и `note`.
- **`config/scoring.yaml`** — категориите, теглата, праговете, флаговете и праговете за оценка. Страницата „Методология“ се генерира от този файл.
- **`config/xbrl_tags.yaml`** — ако някоя компания маркира метрика с различен таг, добавете го в списъка.
- **`config/investment_types.yaml`** — правила за групиране на типовете инвестиции.

## Известни ограничения

- XBRL маркирането се различава между компаниите, затова някои метрики липсват при някои BDC (показват се с „—“, а скорът преразпределя теглата).
- Редовните и специалните дивиденти се разделят евристично по плащанията в Yahoo. При компании с променлив допълнителен дивидент разделянето е по-неточно.
- `yfinance` е неофициално API. При неуспех се ползва последната кеширана цена и профилът показва предупреждение.
