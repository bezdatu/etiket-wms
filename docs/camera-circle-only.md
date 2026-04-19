# Camera Circle Only

Текущая версия проекта упрощена до одного сценария:

1. Открыть Safari.
2. Поднять видеопоток камеры.
3. На полном кадре найти круглый светлый объект.
4. Поставить зелёную рамку вокруг найденного круга.

Что исключено из кода:

- barcode
- OCR
- aggregation
- result screen
- catalog/history/locations
- любая логика распознавания текста

Рабочие файлы:

- `src/App.tsx`
- `src/camera/CircleCameraPage.tsx`
- `src/camera/circleDetector.ts`
- `src/appVersion.ts`
- `src/index.css`

Правило дальнейшей работы:

- сначала доводим стабильный поиск круга в live-preview
- только после этого можно возвращать сохранение объекта или дальнейшее распознавание
