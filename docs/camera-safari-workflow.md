# Camera Flow: Safari + iPhone Continuity

Этот файл фиксирует текущее понимание camera stack, чтобы любой следующий разработчик мог продолжать работу без повторного расследования.

## Целевой сценарий

- Основной браузер для тестов: `Safari`
- Основная камера: `Камера (iPhone (Fedor))` через `Continuity Camera`
- Основной URL: `http://127.0.0.1:5175/scan/camera`

## Контрольная точка

Эта точка считается первым рабочим baseline, к которому можно безопасно откатываться, если снова ломаются:

- полный кадр preview в `Safari`
- стабильный startup камеры
- adaptive зелёная рамка, которая хотя бы находит доминирующий круглый label

Что уже работает в этой точке:

- `Safari + iPhone (Fedor)` поднимают живой поток
- на странице видна версия вида `DEV ... · LOAD ... · HMR ...`
- preview показывает полный wide-кадр без старого узкого portrait-crop
- зелёная рамка больше не берёт почти всю сцену, а цепляется за основной объект заметно лучше прежнего

Что ещё не считается завершённым:

- рамка не идеально повторяет внешний контур круга
- поток `Continuity Camera` на Mac может сам менять framing, и это отдельная системная проблема
- capture/recognition ещё не привязаны к этой рамке как к финальному production source

Если после новых изменений preview или рамка снова ломаются, сначала нужно возвращаться именно к этой контрольной точке, а уже потом продолжать эксперименты.

## Что должно работать

1. `Safari` открывает страницу камеры.
2. При необходимости системный prompt камеры подтверждается.
3. Приложение поднимает live stream с `iPhone (Fedor)`.
4. Пользователь видит полный кадр камеры в корректной ориентации.
5. Только после этого запускаются preview-анализ, рамка и auto-capture.

## Где находится логика

- Экран камеры: [`/Users/Shared/Projects/etiket/src/pages/ScanFlow.tsx`](/Users/Shared/Projects/etiket/src/pages/ScanFlow.tsx)
- Camera capabilities и tuning: [`/Users/Shared/Projects/etiket/src/recognition/cameraControls.ts`](/Users/Shared/Projects/etiket/src/recognition/cameraControls.ts)
- Preview analysis: [`/Users/Shared/Projects/etiket/src/recognition/liveCapture.ts`](/Users/Shared/Projects/etiket/src/recognition/liveCapture.ts)
- Pipeline распознавания: [`/Users/Shared/Projects/etiket/src/recognition/pipeline.ts`](/Users/Shared/Projects/etiket/src/recognition/pipeline.ts)

## Важные правила

- Не менять одновременно `camera startup`, `preview layout` и `recognition pipeline`.
- Сначала держать стабильный live stream.
- Только потом править:
  - full-frame preview
  - ориентацию
  - adaptive frame
  - capture/recognition

## Что уже известно про Safari

- `Safari` может повторно показывать системный prompt камеры даже при сохранённом разрешении.
- Это поведение браузера/macOS, а не приложения.
- На тестах prompt можно прожимать автоматически через `System Events`.
- Самая опасная зона регрессий: любые зависимости `camera startup`-эффекта от состояния viewport/layout.
- `Safari + Continuity Camera` не всегда отдаёт один и тот же shape потока.
  Иногда поток приходит как портретный (`1080x1440`), иногда как широкий (`1440x1080`).
  Поэтому presentation preview должен смотреть на реальные `videoWidth/videoHeight`, а не на предположения.

## Текущий baseline полного кадра

Это состояние, к которому нужно возвращаться при любой регрессии display-слоя.

### Рабочие constraints для `iPhone (Fedor)`

Для `Continuity Camera` сейчас используется более широкий `4:3` профиль:

```ts
{
  deviceId: preferredDevice ? { ideal: preferredDevice.deviceId } : undefined,
  width: { min: 960, ideal: 1440 },
  height: { min: 720, ideal: 1080 },
  aspectRatio: { ideal: 4 / 3 },
  frameRate: { ideal: 30, max: 30 },
}
```

Практический результат этого профиля:

- `Safari` стабильно отдаёт широкий поток `1440x1080`
- preview выглядит как полный wide-кадр
- исчезает прежний узкий портретный зажим

### Как должно работать отображение

- Display-слой должен быть простым:
  - raw `<video>`
  - `object-contain`
  - без canvas-рендера
  - без ручного viewport/crop
- Preview-контейнер может быть широким, но не должен сам кропать поток.
- Если у потока есть letterbox/pillarbox, это нормально. Это лучше, чем терять края кадра.

### Правило поворота

- Поворот нужен только если `Continuity`-поток реально приходит портретным:
  - `videoHeight > videoWidth`
- Если поток уже широкий:
  - `videoWidth > videoHeight`
  - ничего поворачивать не надо

Это правило сейчас зашито в [`/Users/Shared/Projects/etiket/src/pages/ScanFlow.tsx`](/Users/Shared/Projects/etiket/src/pages/ScanFlow.tsx):

- `continuityNeedsRotation`
- `previewAspectRatio`

### Признаки, что display baseline снова сломан

Если виден любой из симптомов ниже, сначала возвращаться именно к этому baseline:

- узкая портретная полоска внутри wide preview
- повёрнутый wide-поток, который на самом деле уже был landscape
- ручной `previewViewport`
- canvas-preview вместо raw `<video>`
- crop/stretch, которого нет в самом Safari stream

### Что нельзя снова делать

- Не вводить ручной `previewViewport` для подгонки окна.
- Не пытаться “лечить” полный кадр через canvas.
- Не менять одновременно:
  - stream constraints
  - знак поворота
  - startup flow
- Не предполагать orientation по типу камеры; смотреть только на реальные `videoWidth/videoHeight`.

## Что ломало стабильный startup

- Если startup-эффект камеры зависит от `updatePreviewViewport`, `cameraProfile` или постоянно меняющегося списка устройств, `Safari` может уйти в loop:
  - переподключение камеры
  - повторные prompts
  - состояние `Подключаю камеру...`
  - пропадание живого stream

Поэтому camera startup должен зависеть только от:

- `cameraFacingMode`
- `selectedDeviceId`
- обработчика ошибок камеры

И не должен напрямую зависеть от layout-пересчётов preview.

## Текущий безопасный порядок работы

1. Проверить, что `Safari` поднимает живой поток.
2. Проверить выбранную камеру в UI.
3. Только если stream живой, править preview display.
4. Только после этого включать adaptive framing и авторамку.

## Быстрые признаки, что startup живой

На странице в debug или через JS:

- `video.videoWidth > 0`
- `video.videoHeight > 0`
- `video.paused === false`
- `video.readyState === 4`
- статус на экране: `Камера готова. Наведите этикетку в рамку.`

## Что делать дальше

Следующий приоритет после стабилизации запуска:

1. Не трогать baseline полного кадра.
2. Поверх него отдельно настраивать зелёную рамку и adaptive search.
3. После этого вводить capture/recognition-улучшения.

## Как возвращаться к этой точке

Рабочая точка должна быть зафиксирована не только в этом файле, но и в git отдельным snapshot-коммитом.

Рекомендуемый порядок возврата:

1. Посмотреть snapshot-коммит в `git log --oneline`.
2. Если нужно просто сравнить:
   - `git show <snapshot-commit>:src/pages/ScanFlow.tsx`
   - `git show <snapshot-commit>:src/recognition/barcode.ts`
3. Если нужно реально вернуться:
   - создать новую ветку от snapshot-коммита
   - или сделать `git reset --hard <snapshot-commit>` только по явному решению владельца репозитория

Главное правило:

- не пытаться восстанавливать эту точку вручную по памяти
- сначала брать snapshot из git, потом уже продолжать работу

## Текущий baseline зелёной рамки

Зелёная рамка больше не должна зависеть только от общего edge/brightness detector-а по всей сцене.

Для `Safari + iPhone (Fedor)` рабочий путь сейчас такой:

1. Берётся полный preview-кадр из живого `<video>` в `canvas`.
2. ZXing пробует найти barcode прямо на этом `canvas` через `decodeFromCanvas(...)`.
3. Если barcode найден, `ResultPoint[]` используется как якорь объекта.
4. Вокруг barcode локально строится bright/neutral connected component.
5. Итоговая рамка рисуется уже по этой локальной светлой области, а не по всей сцене.

Это реализовано в:

- [`/Users/Shared/Projects/etiket/src/recognition/barcode.ts`](/Users/Shared/Projects/etiket/src/recognition/barcode.ts)
  - `scanPreviewBarcode(...)`
- [`/Users/Shared/Projects/etiket/src/pages/ScanFlow.tsx`](/Users/Shared/Projects/etiket/src/pages/ScanFlow.tsx)
  - `buildBoxFromBarcodePoints(...)`
  - `buildRefinedObjectBoxFromBarcode(...)`

### Что считается рабочим поведением рамки

- Рамка сужается на реальный label, а не на всю коробку/фон.
- После нескольких секунд на статичном кадре рамка удерживает объект и не расползается обратно.
- Barcode служит якорем, а итоговый bbox охватывает объект шире, чем одна линия штрихкода.

### Что считается регрессией рамки

- Рамка снова занимает почти весь preview.
- Рамка живёт только от фона/контуров коробки.
- После появления barcode рамка не уменьшается под label.
- При стабильном кадре рамка продолжает хаотично дёргаться и расширяться на сцену.

### Что нельзя снова ломать

- Не возвращать `decodeFromVideoElement(...)` как главный live-source для рамки: в Safari этот путь уже показал ненадёжный bbox.
- Не делать зелёную рамку purely heuristic на всю сцену, если barcode geometry уже найдена.
- Не трогать baseline полного кадра, когда меняется только object framing.
