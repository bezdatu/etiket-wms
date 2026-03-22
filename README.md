# PartSense WMS

Локальное приложение для складского учета с приоритетом на надежное распознавание похожих этикеток.

## Что есть сейчас
1. Камерный scan flow с каскадным recognition pipeline.
2. Barcode-first логика с fallback на visual/ROI scoring.
3. Локальный catalog и история операций.
4. Benchmark и diagnostics режим без внешних сервисов.

## Local Setup
1. `npm install`
2. `npm run dev`
3. Открыть локальное приложение и перейти в `Сканирование`

## Recognition Pipeline
Подробности: [recognition-pipeline.md](/Users/fedor/etiket/docs/recognition-pipeline.md)

Ключевые компоненты:
1. `src/config/recognition.ts` — thresholds и ROI config
2. `src/recognition/*` — scanner, OCR, scoring, diagnostics
3. `src/pages/RecognitionWorkbench.tsx` — локальный benchmark mode

## Локальная проверка
1. Добавить несколько товаров в catalog через scan flow.
2. Для похожих товаров с одинаковым barcode прогнать `Benchmark и diagnostics`.
3. Проверить:
   - какой barcode найден
   - какие top candidates выданы
   - где pipeline просит `rescan`
   - accuracy benchmark по локальным кейсам

## Reference Samples
Структура и правила: [README.md](/Users/fedor/etiket/reference-samples/README.md)

