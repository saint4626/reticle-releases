# Reticle 💎

**Reticle** — это современный инструмент для создания скриншотов на Windows, ориентированный на эстетику. Аналог CleanShot X, но для PC. Приложение позволяет мгновенно делать красивые снимки экрана с автоматическим добавлением фона, теней и скруглений.

---

## 🛠 Технологический стек

Проект построен на связке **Rust** (для производительности и системных вызовов) и **web-технологий** (для гибкого UI).

### Core (Backend)

* **Framework:** [Tauri v2](https://v2.tauri.app/)
* **Language:** Rust
* **Скриншотинг:** `xcap` (кроссплатформенный захват экранов и окон)
* **Буфер обмена:** `arboard` (копирование изображений и текста)
* **Обработка изображений:** `image`, `base64`
* **Параллелизм:** `rayon` (пакетная обработка превью)
* **Файловая система:** `std::fs` + `chrono` (генерация имен файлов)

### UI (Frontend)

* **Framework:** Vue 3 (Composition API + TypeScript)
* **Styling:** Tailwind CSS v4 + [DaisyUI v5](https://daisyui.com/)
* **State Management:** Pinia
* **Icons:** `lucide-vue-next`
* **Utils:** `@vueuse/core`
* **Rendering:** `modern-screenshot` (генерация итогового изображения из DOM-элемента с CSS-эффектами)
* **Color Managment:** `color`

---

## 🗺️ Roadmap & Progress

### ✅ Phase 1: Setup & Basic UI
* [x] Инициализация проекта Tauri v2 + Vue 3.
* [x] Настройка Tailwind CSS v4 и DaisyUI.
* [x] Базовая верстка редактора (Canvas + Controls).

### ✅ Phase 2: Fullscreen Capture
* [x] Интеграция `xcap` для захвата всего экрана.
* [x] Передача изображения из Rust во Frontend (Base64).
* [x] Отображение скриншота в редакторе.

### ✅ Phase 3: Export & Save
* [x] Рендеринг финального изображения (DOM -> PNG) через `modern-screenshot`.
* [x] Копирование в буфер обмена (`arboard`).
* [x] Сохранение в папку "Изображения/Reticle" с временной меткой.

### ✅ Phase 4: Region Capture (Выделение области)
* [x] Оверлей для выделения области экрана.
* [x] Логика "заморозки" экрана (screenshot overlay).
* [x] Обрезка изображения (Crop) на клиенте.

### ✅ Phase 5: Window Capture (Захват окон)
* [x] Получение списка открытых окон через `xcap`.
* [x] Генерация мини-превью (thumbnails) для окон.
* [x] Оптимизация загрузки превью (Parallel batch processing с `rayon`).
* [x] UI селектора окон с фильтрацией и сеткой.

### ✅ Phase 6: Settings & Shortcuts
* [x] Глобальные горячие клавиши (Global Shortcuts) для быстрого вызова.
    * `PrintScreen` -> Fullscreen
    * `Alt + PrintScreen` -> Window
    * `Shift + PrintScreen` -> Region
* [x] Окно настроек хоткеев, а также других параметров (Settings).
* [x] Колор пикер для цвета фона и цветов градиента в редакторе.
* [x] Функция замены фона изображением (Background Image).
* [x] Функция размытия фона (Blur Background).
* [x] более детальная настройка тени (Shadow) в редакторе.
* [x] Сохранение последних настроек редактора (Padding, Colors) в `localStorage` или конфиг.
* [x] Tray Icon (иконка в трее) для фоновой работы.

### ✅ Phase 7: Styling & Basic Polish
* [x] Анимации интерфейса (Transitions).
* [x] Применение шрифта `geist-mono`.
* [x] Создание кастомного стилизованного тайтлбара для окна редактора (Custom Window Controls).
* [x] Применение библиотеки иконок `lucide-vue-next` вместо эмодзи.
* [x] Стиль интерфейса (DaisyUI): Черный минималистичный, с прозрачным фоном.
* [x] Ограничение минимального размера окна.

### ✅ Phase 8: UX Refinement (Шлифовка)
* [x] **Fix Animations:** Исправление дерганых анимаций и переходов между окнами.
* [x] **Tray Logic:** Исправление поведения иконки в трее (сейчас по одиночному клику окно открывается и сразу закрывается).
* [x] Доводка дизайна панели размеров к стилю и темной теме а так же их слайдеров.
* [x] Доводка дизайна инструмента выбора цвета в редакторе под стиль и темную тему. 
* [x] Отключить выделение интерфейса в редакторе в канвасе и в тайтл баре что бы не выглядело как сайт
* [x] **Performance:** Оптимизация скорости открытия редактора (переход на JPEG для превью, RAM-хранилище).

### 🔮 Phase 9: Advanced Features (Новые фишки)
* [x] Функция блюра чувствительных данных в скриншотах (например, пароли, номера карт).
* [x] Реализовать поддержку множества мониторов (multi-monitor support)
* [x] Добавить кнопку очистки скриншота в редакторе (кнопка с корзинкой для удаления текущего скриншота).
* [x] Добавить возможность зума в редакторе колесиком мыши + перетаскивание мышью в пределах холста.

### ✅ Phase 10: History and Polish
* [x] **History:** История скриншотов с возможностью редактирования. 
* [x] **Polish:** Финальные правки интерфейса, оптимизация производительности.

### ✅ Phase 11: Финализация перед MVP
* [x] Аннотации (Стрелочки) в редакторе (Текст убран по требованию).
* [x] Настройка стиля стрелок (цвет, толщина, форма).
* [x] Автозапуск (Autostart) в настройках.
* [x] Минимальное приветствие при первом запуске приложения.
* [x] Редизайн панели настроек (вкладки, темная тема, DaisyUI).
* [x] Увеличение минимального размера окна.
* [x] Шлифовка UI (логотипы, иконки, отступы).

### Phase 12: Release Engineering (Подготовка к релизу)
1.110. 🔐 Система Лицензирования (HWID Lock)
111. * [x] Реализовать генерацию HWID (Hardware ID) на клиенте.
    *   **Реализация:** Используется crate `machine-uid` для получения уникального ID устройства.
    *   **Безопасность:** ID солится секретным ключом (`app_secret`) и хешируется через SHA-256 (crate `sha2`), чтобы предотвратить реверс-инжиниринг оригинального MachineGUID.
    *   **Логирование:** При старте приложения хеш тихо генерируется и пишется в лог-файл (INFO уровень) для отладки и идентификации пользователей.
112. * [ ] Реализовать проверку цифровой подписи (RSA/Ed25519) при старте.
* [ ] Сделать окно ввода лицензионного ключа (если ключа нет или он невалидный — блокировать функционал).
2. 📦 Сборка Инсталлятора (Installer Polish)
    Пользователь судит о качестве софта еще до запуска, по инсталлятору.
* [x] Настроить tauri.conf.json для NSIS (стандартный установщик Windows):
    * Добавить лицензионное соглашение (EULA).
    * Установить красивые иконки для .exe и самого установщика.
    * Настроить имя производителя (Publisher).
* [x] Проверить, как приложение выглядит в «Установке и удалении программ» (иконка, название).
3. 🐛 Логирование (Logging)
    Когда у первого пользователя приложение упадет (а это случится), ты не сможешь понять почему без логов.
* [x] Подключить tauri-plugin-log.(Установлен, нужна реализация)
* [x] Настроить запись ошибок (error!, info!) в файл в папке пользователя (AppData/Roaming/Reticle/logs).
* [x] Добавить кнопку в настройках: «Открыть папку с логами» (чтобы юзер мог скинуть тебе файл).
4. 🔄 Проверка обновлений (Simple Update Checker)
    Полноценный автоапдейтер требует подписи кода ($$$), но уведомить пользователя нужно.
* [x] Сделать простую проверку JSON-файла с GitHub/твоего сервера при старте.
    *   **Реализация:** Приложение запрашивает `version.json` с GitHub и сравнивает его с локальной версией (`core:app:allow-version`).
* [x] Если версия на сервере выше текущей — показывать красивый бейдж или тост: «Доступна версия 0.9.1! Скачать».
    *   **UI:** Реализована через расширенные уведомления (Toasts) с поддержкой действий (кнопок) и заголовков.
    *   **Действие:** Кнопка "Скачать" открывает URL релиза в браузере по умолчанию (`shell:allow-open`).
5. 🌐 Мультиязычность (i18n)
    Поддержка нескольких языков интерфейса для охвата широкой аудитории.
* [x] Подключить `vue-i18n` (v9, Composition API).
* [x] Реализовать переключение языков "на лету" (Runtime language switching).
* [x] Добавить переводы для основных языков:
    * [x] Русский (ru)
    * [x] Английский (en)
* [x] Сохранять выбранный язык в настройках.

### 🎥 Phase 13: Video Mode (Screen Studio Style)

#### 13.1. Переключение режимов и UI (Mode Toggle)
* [x] Добавить глобальный переключатель в главном окне (Режим: Скриншот 📸 / Видео 🎥).
* [x] Адаптировать тайтлбар и глобальные шорткаты (например, `Ctrl+Shift+R` для старта/стопа записи).
* [x] Создать интерфейс подготовки к записи (выбор монитора, включение/выключение микрофона и системного звука).
* [x] Окно-виджет статуса записи (маленькая плавающая панель с таймером и кнопкой "Стоп", которая не попадает на запись).

#### 13.2. Ядро захвата (Recording Engine & Metadata)
* [x] **Video Capture:** Реализован захват экрана через `windows-capture` (монитор, окно, область).
* [x] **Audio Capture:** Синхронная запись системного звука и микрофона (два отдельных WAV-файла через `cpal`).
* [x] **Telemetry:** Rust-модуль `rdev` для записи координат мыши, кликов, нажатий клавиш в `tracking.json` с привязкой к миллисекундам.
* [x] **Сохранение:** Логика сохранения сырого видеофайла (mp4) и файла метаданных в `Videos/Reticle/`.
* [x] **Warmup API:** Механизм прогрева (запуск пайпов до фактического старта) + команда `confirm_recording` для мгновенного старта после отсчёта.
* [x] **GPU Encoding:** Автоматическое определение GPU (NVIDIA/AMD/Intel) и выбор кодека (`h264_nvenc`, `h264_amf`, `h264_qsv`).
* [x] **Пауза/Возобновление:** Синхронная пауза видео и аудио потоков.
* [x] **Выбор FPS:** Поддержка 30 / 60 / 120 FPS.
* [x] **Тоггл курсора:** Опция скрытия/показа системного курсора через `CursorCaptureSettings`.

#### 13.3. Видеоредактор: Таймлайн и Плеер (Video Editor UI)
* [x] **Video Player:** Компонент видеоплеера (обертка над `<video>`), синхронизированный с текущим Canvas-редактором (фон, тени, паддинг).
* [x] **Video Timeline:** Реализован компонент Timeline (временная шкала) + Линейка (Ruler).
* [x] **Scrubbing & Controls:** Ползунок воспроизведения (Playhead), кнопки управления (Play, Pause, Restart) и горячие клавиши.
* [x] **Event Markers:** Визуализация кликов мыши на таймлайне (точки с тултипами).
* [x] **Audio Waveforms:** Визуализация аудиодорожек (System + Mic) через `wavesurfer.js` с синхронизацией.

#### 13.4. Магия анимаций (Motion, Zoom & Fake Cursor)
* [x] **Fake Cursor:** SVG-курсор поверх видео, двигающийся по координатам из JSON (бинарный поиск + Catmull-Rom сплайн интерполяция для органичных дуговых траекторий).
* [x] **Cursor Smoothing:** Пружинная физика (stiffness, damping) для сглаживания движения курсора.
* [x] **Cursor Style Tracking:** Определение типа системного курсора в реальном времени через `GetCursorInfo()` (глобальный системный курсор, работает из любого потока). Поддержка: `default`, `text`, `pointer`, `wait`, `not-allowed`, resize-курсоры.
* [x] **Cursor Style Rendering:** Fake cursor меняет форму в зависимости от стиля — стрелка (`@radix-icons/vue` `CursorArrowIcon`, белая заливка + чёрный outline) и I-beam (`CursorTextIcon`). Pointer фоллбечит на стрелку.
* [x] **Auto-Zoom:** Алгоритм кластеризации кликов для автоматической расстановки keyframes зума (2x).
* [x] **Keyframe UI:** Ромбовидные маркеры keyframes на таймлайне + кнопки Toggle Cursor / Toggle Zoom / Auto Zoom / Clear.

#### 13.5. Рендеринг и Экспорт (Mediabunny)
* [x] **Render Engine (Frontend):** Экспорт реализован через библиотеку `mediabunny` (WebCodecs API) — покадровый рендеринг в `OffscreenCanvas` без FFmpeg sidecar.
* [x] **Frame Compositing:** Каждый кадр: фон (градиент / изображение / blur) → тень → видео с `borderRadius` → оверлеи (курсор, клавиши).
* [x] **Zoom в экспорте:** Зум-трансформы (keyframes, easing) корректно применяются при рендере каждого кадра через snapshot-копию keyframes (без реактивности).
* [x] **Cursor в экспорте:** Canvas-рендер курсора (`drawDefaultCursor`, `drawTextCursor`) синхронизирован с tracking-данными. Pointer фоллбечит на стрелку (убран кривой `arc`-круг).
* [x] **Audio mixing (Rust/FFmpeg):** После Mediabunny-экспорта видео без звука — Rust вызывает FFmpeg для подмешивания системного аудио и/или микрофона из отдельных WAV-файлов.
* [x] **Форматы:** MP4 (AVC/H.264, hardware acceleration) и WebM (VP9, software).
* [x] **Качество:** 4 пресета (Very High / High / Medium / Low) через `mediabunny` bitrate constants.
* [x] **UI прогресса:** Прогресс-бар экспорта с фазами (`overlay` → `compositing` → `done`).
* [x] **ExportDialog:** UI выбора формата, кодека, качества, аудиодорожек + сохранение пути через системный диалог.

#### 13.6. Рефакторинг и качество кода (Code Quality)
* [x] **Декомпозиция `App.vue`** (701 → 170 строк): вынесены `useCapture`, `useShortcuts`, `useOverlay`, `RecordOverlay`, `RegionOverlay`.
* [x] **Декомпозиция `EditorNavbar.vue`** (776 → 120 строк): вынесены `CaptureToolbar`, `VideoControls`, `AnnotationTools`, `EditorProperties`, `WindowControls`.
* [x] **Shared types & utils**: `types/index.ts`, `utils/blob.ts`, `utils/image.ts`, `utils/history.ts`.
* [x] **Удаление мёртвого кода**: `capture_region` (Rust), `greet` command.
* [x] **Секреты**: HWID salt вынесен из кода в `.env` → `env!()` через `dotenvy` (compile-time).
* [x] **Debug-логи**: `console.log` → `tauri-plugin-log` (`info`/`error`) в `recorder.ts`, `App.vue`, `AnnotationTools.vue`.
* [x] **Toast-уведомления**: ошибки записи видео показываются пользователю через `notificationStore` (вместо `console.error`).
* [x] **i18n**: добавлены ключи `editor.video_errors.*` для ошибок видео (en/ru).
* [x] **Антипаттерн Vue**: `onUnmounted` внутри `onMounted` в `RegionOverlay.vue` → вынесен на верхний уровень setup.
* [x] **Магические числа**: вынесены в `utils/constants.ts` (таймауты, countdown, timer tick).
* [x] **`useRecordingTimer` composable**: countdown и timer логика извлечена из `video.ts` store.

---

## 🏗 Архитектура данных

### Data Flow (Поток данных)

1. **Capture:** Rust (`xcap`) делает захват -> конвертирует буфер пикселей в `Base64` -> отправляет во Frontend.
2. **Edit:** Frontend (`Vue`) отображает Base64 картинку внутри контейнера `<div>`. Пользователь меняет CSS-свойства (padding, shadow) через UI (`DaisyUI`).
3. **Render:** Библиотека `modern-screenshot` делает "снимок" настроенного DOM-элемента -> получает `Blob/Base64`.
4. **Save:** Frontend отправляет финальный Base64 обратно в Rust -> Rust (`arboard`) кладет его в буфер обмена или сохраняет на диск.

---

## 📂 Структура проекта

```text
reticle/
├── src-tauri/
│   ├── capabilities/       // Tauri v2 capabilities
│   ├── icons/              // Иконки приложения
│   ├── src/
│   │   ├── commands/       // Логика Rust
│   │   │   ├── capture.rs  // Логика захвата (fullscreen, region, window)
│   │   │   └── export.rs   // Логика экспорта (буфер обмена, файл)
│   │   ├── lib.rs          // Инициализация и регистрация команд
│   │   └── main.rs         // Точка входа
│   ├── tauri.conf.json     // Конфигурация Tauri
│   └── Cargo.toml          // Зависимости (xcap, image, rayon, etc.)
│
├── src/
│   ├── assets/             // Статика (шрифты, svg)
│   ├── components/
│   │   ├── Editor/         // Редактор (Canvas, Navbar)
│   │   ├── History/        // История скриншотов
│   │   ├── Overlay/        // Оверлеи (Region, Window, Monitor Selector)
│   │   ├── Settings/       // Настройки
│   │   └── UI/             // UI компоненты (Toast, etc.)
│   ├── stores/             // Pinia сторы (editor, history, viewport)
│   ├── styles/             // Глобальные стили
│   ├── utils/              // Утилиты
│   ├── App.vue
│   └── main.ts
```

### 🎬 Phase 14: Video Trimming & Timeline Editing

#### 14.1. Обрезка видео (Trim In / Trim Out) ✅

Пользователь часто записывает лишние секунды в начале и конце — момент переключения вкладки, нажатие хоткея старта/стопа. Нужна возможность обрезать эти хвосты перед экспортом.

**Реализовано:**

`videoEditor` store:
* Добавлены `trimIn: ref(0)` и `trimOut: ref(0)` (инициализируется в `duration` после загрузки метаданных).
* Экшены `setTrimIn(t)` и `setTrimOut(t)` с клампингом — `trimIn` не может превышать `trimOut - 0.1s` и наоборот.
* Оба значения сбрасываются в `closeSession()` и `loadSession()`.

`VideoTimeline.vue`:
* На canvas рисуются два drag-хэндла: зелёный **Trim In** (стрелка вправо) и оранжевый **Trim Out** (стрелка влево).
* Зоны вне trim-диапазона затемняются полупрозрачным оверлеем прямо на canvas.
* Хэндлы перетаскиваются мышью (`mousedown` → глобальный `mousemove` → `mouseup`).
* Курсор меняется на `ew-resize` при наведении на хэндл.
* Trim-хэндлы имеют приоритет над скраббингом и keyframe-драгом.
* Перерисовка по `watch([trimIn, trimOut])`.

`VideoEditorCanvas.vue`:
* В `onTimeUpdate` добавлена проверка: если `currentTime >= trimOut` — видео останавливается.

`useVideoExport.ts`:
* Кадры вне `[trimIn, trimOut]` пропускаются в Mediabunny `process()` (возвращают `null`).
* `totalFrames` считается от trimmed duration для корректного прогресс-бара.
* `trimStart` / `trimEnd` передаются в Rust-команду `mix_audio_tracks_for_export`.
* Для разрешений выше 1080p автоматически используется `prefer-software` (hardware H.264 encoder не поддерживает High Profile 5.0 для 2K/4K в WebCodecs).

`video.rs` — `mix_audio_tracks_for_export`:
* Принимает `trim_start: Option<f64>` и `trim_end: Option<f64>`.
* Аудио-инпуты получают `-ss trim_start` для синхронизации с обрезанным видео.
* Длительность ограничивается через `-t (trim_end - trim_start)`.
* Когда `trim_start > 0` — видео проходит через `setpts=PTS-STARTPTS` в `filter_complex` для нормализации PTS к нулю (иначе плеер показывает смещённое время). При этом видео перекодируется через `libx264 -crf 18`; без trim используется быстрый `-c:v copy`.

#### 14.2. Фоновая музыка (Background Music Track) ✅

Возможность добавить свою аудиодорожку (WAV / MP3 / AAC / OGG) поверх системного звука и микрофона — удобно для туториалов, демо и геймплейных записей.

**Реализовано:**

`videoEditor` store:
* Добавлены `musicTrackPath`, `musicVolume` (0–2.0), `musicMuted`, `musicOffset` (смещение в секундах), `musicDuration` (длительность файла, устанавливается компонентом).
* Добавлены `sysVolume`, `sysMuted`, `micVolume`, `micMuted` — управление уровнями системного звука и микрофона прямо из редактора.
* Экшены: `setMusicTrack`, `setMusicVolume`, `setMusicMuted`, `setMusicOffset` (с клампингом до `musicDuration - videoDuration`), `setMusicDuration`, `setSysVolume`, `setSysMuted`, `setMicVolume`, `setMicMuted`.
* Все значения сбрасываются в `loadSession()` и `closeSession()`.

`AudioWaveform.vue`:
* Компонент полностью переработан — поддерживает пропы `playable`, `offset`, `muted`, `volume`.
* Для `playable` дорожек WaveSurfer воспроизводит аудио синхронно с видео (play/pause/seek через `watch(isPlaying)` и `watch(currentTime)`).
* Визуализация offset: waveform растягивается пропорционально `musicDuration / videoDuration` и сдвигается через `translateX` — видно какой участок музыки попадает в видео.
* Громкость и мьют применяются через `wavesurfer.setVolume()` в реальном времени.
* При мьюте дорожка визуально становится серой (`grayscale + opacity` только на waveform-clip, контролы остаются нормальными).
* Emit `audioDuration` при загрузке файла — стор получает реальную длительность.
* Антиартефактная логика: `seekTo` вызывается только при паузе или при расхождении позиции > 0.5s во время воспроизведения.

`VideoTimeline.vue`:
* Дорожки System Audio и Microphone получили контролы (мьют + слайдер громкости), появляющиеся при наведении — аналогично Music дорожке.
* Music дорожка: drag для смещения offset (throttled через `requestAnimationFrame`), контролы мьют/громкость/удалить.
* Hover-состояние контролов управляется через JS refs (`sysHover`, `micHover`, `musicHover`) — обходит ограничения Vue scoped CSS через границы компонентов.

`VideoEditorCanvas.vue`:
* `<video>` теперь всегда `muted` — весь звук воспроизводится через WaveSurfer дорожки, что позволяет корректно управлять уровнями в редакторе.

`ExportDialog.vue`:
* Убрана секция Audio Tracks с чекбоксами — управление аудио перенесено в таймлайн.
* `includeSystemAudio` / `includeMicAudio` вычисляются из `sysMuted` / `micMuted` стора.

`useVideoExport.ts`:
* Передаёт `sysVolume`, `micVolume`, `musicPath`, `musicVolume`, `musicOffset` в Rust-команду.

`video.rs` — `mix_audio_tracks_for_export`:
* Принимает `sys_volume: Option<f64>` и `mic_volume: Option<f64>`.
* Применяет `volume=` FFmpeg фильтр для каждой дорожки (sys, mic, music) при значениях отличных от 1.0.
* Music дорожка: `-ss music_offset` для выбора нужного участка, `-t videoDuration` для обрезки по длине видео.
* Поддержка всех комбинаций дорожек (0, 1, 2, 3 аудио-входа) через `filter_complex` с `amix`.

`i18n`:
* Добавлены ключи `music_track`, `add_music`, `music_volume`, `remove_music` в `en.json` и `ru.json`.


### 🎨 Phase 15: Emoji Stickers ✅

Интерактивные эмодзи-стикеры на скриншотах в стиле Figma/Canva.

#### 15.1. Архитектура (Hybrid DOM)
* [x] Стикеры рендерятся как DOM-элементы поверх canvas внутри `#capture-target`.
* [x] `modern-screenshot` подхватывает их при экспорте автоматически — без изменений в логике сохранения.
* [x] Данные стикера: `{ id, emoji, x, y, size, rotation }`.

#### 15.2. Управление стикерами (Figma-style)
* [x] **Создание:** Кнопка (Smile-иконка) в тулбаре открывает пикер эмодзи → клик по эмодзи размещает стикер в центре холста.
* [x] **Выделение:** Клик по стикеру показывает dashed рамку с ручками трансформации. Деселект — клик мимо стикера.
* [x] **Перемещение:** Drag за тело стикера (ЛКМ) с порогом 3px для отличия от клика.
* [x] **Масштаб:** Drag за любую из 4 угловых ручек — ratio-based алгоритм (currentDist / startDist от экранного центра стикера), стабильно для всех углов.
* [x] **Вращение:** Drag за rotate-ручку (кружок над рамкой) через `Math.atan2` от экранного центра стикера.
* [x] **Удаление:** SVG-крестик на рамке (красная кнопка, видна только при выделении).
* [x] **Панорамирование холста** перенесено на среднюю кнопку мыши (колёсико) — устраняет конфликт с drag стикеров. `@auxclick.prevent` блокирует авто-скролл браузера.

#### 15.3. Store & State
* [x] `EmojiSticker` интерфейс в `stores/editor.ts`: `{ id, emoji, x, y, size, rotation }`.
* [x] `stickers: shallowRef<EmojiSticker[]>` + `addSticker`, `removeSticker`, `updateSticker`.
* [x] `selectedStickerId: ref<string | null>` для управления выделением.
* [x] `EditorTool` расширен типом `'sticker'`.
* [x] `setImage()` сбрасывает `stickers.value = []` и `selectedStickerId = null`.
* [x] Undo поддержка для стикеров (интегрирована в общий `history` массив).

#### 15.4. UI & i18n
* [x] Встроенный пикер эмодзи: 4 категории (~80 эмодзи), без внешних зависимостей, чистый Vue `v-if` (без DaisyUI dropdown конфликтов), закрывается кликом вне.
* [x] `EmojiStickerLayer.vue` — отдельный компонент слоя, `pointer-events: none` на контейнере, `all` на стикерах. `setPointerCapture` для надёжного drag за пределами элемента.
* [x] i18n ключ `editor.tools.sticker` добавлен во все 5 локалей: en, ru, es, it, pt-BR.
