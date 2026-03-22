# Recognition Pipeline

## Цель
Надежно различать похожие этикетки локально, включая товары с одинаковым barcode.

## Этапы
1. `frame quality check`
2. `label detection / crop / normalization`
3. `barcode-first scan`
4. `candidate lookup in local catalog`
5. `ROI OCR`
6. `conflict resolution`
7. `confidence scoring`
8. `rescan / user confirmation`
9. `local diagnostics / benchmark`

## Где что лежит
- Thresholds: [recognition.ts](/Users/fedor/etiket/src/config/recognition.ts)
- Pipeline: [pipeline.ts](/Users/fedor/etiket/src/recognition/pipeline.ts)
- Barcode layer: [barcode.ts](/Users/fedor/etiket/src/recognition/barcode.ts)
- ROI OCR: [ocr.ts](/Users/fedor/etiket/src/recognition/ocr.ts)
- Diagnostics storage: [diagnostics.ts](/Users/fedor/etiket/src/recognition/diagnostics.ts)
- Benchmark UI: [RecognitionWorkbench.tsx](/Users/fedor/etiket/src/pages/RecognitionWorkbench.tsx)

## Как это работает
1. Кадр валидируется по brightness, contrast, sharpness, resolution.
2. Из кадра выделяется наиболее информативная область этикетки и нормализуется в квадратный ROI.
3. Сначала ищется barcode через `BarcodeDetector`, затем fallback на `ZXing`.
4. Если barcode найден, catalog lookup сначала сужает кандидатов по barcode hints.
5. Для нескольких ROI считается OCR-текст и dHash региона.
6. Candidate scorer комбинирует:
   - barcode match
   - global visual hash
   - ROI hash similarity
   - OCR text overlap
   - penalty за плохое качество кадра
7. Если confidence низкий или margin между top-2 кандидатами слишком мал, pipeline требует confirmation или rescan.

## Локальная диагностика
Каждый scan пишет локальный diagnostic entry в `localStorage`:
- quality reasons
- найденный barcode
- top candidates
- normalized crop
- флаги `rescanRecommended` и `requiresConfirmation`

## Benchmark Mode
Открыть `Сканирование -> Benchmark и diagnostics`.

Для измеримого accuracy загружай файлы с именем:
`PRODUCT_NAME__case-01.jpg`

Тогда benchmark посчитает:
- число кейсов
- средний confidence
- число случаев с `rescanRecommended`
- accuracy по имени продукта

## Как добавить новую конфликтную этикетку
1. Отсканировать товар в локальном приложении.
2. На экране подтверждения оставить корректное имя, barcode и описание.
3. Подтвердить scan: приложение сохранит `recognitionProfile` с visual hash, ROI hashes и barcode hints.
4. Если у двух товаров один и тот же barcode:
   - зафиксировать разные `name`
   - добавить отличительные поля в `description` или `metadata`
   - положить эталонные кадры в [reference-samples](/Users/fedor/etiket/reference-samples)
   - прогнать benchmark через `Benchmark и diagnostics`
5. При необходимости скорректировать thresholds в [recognition.ts](/Users/fedor/etiket/src/config/recognition.ts)

## Ограничения текущей версии
- Perspective correction пока эвристический, без полноценной геометрической rectification.
- OCR основан на локальном `ocrad.js`; для сложных шрифтов и кириллицы точность ограничена.
- Нужна реальная библиотека эталонных изображений в `reference-samples`, чтобы калибровать ambiguous cases.
