# VikWay v1.1

Стабильная зафиксированная версия сервиса пешеходной маршрутизации на `FastAPI + React + Leaflet`.

Версия `v1.1` включает:
- рабочую backend-логику маршрутизации;
- локально и на сервере одинаковую загрузку графа и пространственных слоев;
- production-конфигурацию для деплоя на Timeweb;
- собранный фронтенд в `frontend/dist`.

## Состав проекта

- `backend/` — API на FastAPI.
- `frontend/` — интерфейс на React + Vite.
- `backend/data/export/` — данные маршрутизации:
  - `G.pkl`
  - `nodes.npy`
  - `green.pkl`
  - `rail.pkl`
- `Dockerfile` — сборка контейнера для деплоя.

## Что делает сервис

Сервис строит пешеходные маршруты между двумя точками и поддерживает режимы:
- `Кратчайший`
- `Тихий`
- `Зеленый`
- `Сбалансированный`

При включенной опции альтернатив сервис пытается вернуть несколько различающихся маршрутов, если такие варианты действительно существуют в графе.

## Требования

- Python `3.11`
- Node.js `18+`
- npm

## Локальный запуск

### 1. Запуск backend

Откройте PowerShell в каталоге:

```powershell
cd "C:\Users\chekalina\Documents\New project\vikway_v1.1_repo\backend"
```

Создайте виртуальное окружение:

```powershell
py -3.11 -m venv .venv
```

Активируйте его:

```powershell
.\.venv\Scripts\Activate.ps1
```

Установите зависимости:

```powershell
pip install -r requirements.txt
```

При необходимости явно задайте путь к данным:

```powershell
$env:VIKWAY_EXPORT_DIR="C:\Users\chekalina\Documents\New project\vikway_v1.1_repo\backend\data\export"
```

Запустите API:

```powershell
uvicorn app.main:app --reload --host 127.0.0.1 --port 8001
```

Проверка:

- `http://127.0.0.1:8001/api/health`
- `http://127.0.0.1:8001/api/meta`

### 2. Запуск frontend

Откройте второй PowerShell в каталоге:

```powershell
cd "C:\Users\chekalina\Documents\New project\vikway_v1.1_repo\frontend"
```

Установите зависимости:

```powershell
npm install
```

Создайте файл `.env` в каталоге `frontend`:

```env
VITE_API_BASE_URL=http://127.0.0.1:8001
```

Запустите dev-сервер:

```powershell
npm run dev -- --host 127.0.0.1 --port 5175 --strictPort
```

Откройте в браузере:

```text
http://127.0.0.1:5175
```

## Production-сборка frontend

Если нужно пересобрать production-фронтенд:

```powershell
cd "C:\Users\chekalina\Documents\New project\vikway_v1.1_repo\frontend"
npm run build
```

После сборки статические файлы будут лежать в:

```text
frontend/dist
```

Они автоматически раздаются FastAPI из того же контейнера.

## Деплой на Timeweb

### Настройки приложения

- Тип: `Dockerfile`
- Репозиторий: этот репозиторий
- Путь до директории проекта: пусто
- Путь проверки состояния: `/api/health`

### Переменная окружения

Обязательно задайте переменную:

- имя: `VIKWAY_EXPORT_DIR`
- значение: `/srv/backend/data/export`

Важно:
- значением должна быть только строка пути;
- нельзя указывать значение в виде `VIKWAY_EXPORT_DIR=/srv/backend/data/export`.

### Что важно для production

Для корректной загрузки пространственных слоев в контейнере нужны:
- `pandas`
- `geopandas`

Без них сервис запускается, но:
- не загружаются `green.pkl` и `rail.pkl`;
- деградируют метрики шума и озеленения;
- маршруты могут схлопываться в один.

В `v1.1` это уже исправлено в `backend/requirements.txt`.

## API

### `GET /api/health`

Проверка доступности сервиса.

Пример ответа:

```json
{
  "status": "ok"
}
```

### `GET /api/meta`

Возвращает доступные режимы и метаданные сервиса.

### `POST /api/routes`

Строит маршрут между двумя точками.

Пример запроса:

```json
{
  "start": { "lat": 59.41, "lon": 56.79 },
  "end": { "lat": 59.40, "lon": 56.83 },
  "mode": "green",
  "include_alternatives": true
}
```

## Отладочный endpoint

В проекте оставлен служебный endpoint:

- `GET /api/debug/runtime`

Он нужен для проверки production-окружения:
- какой `export_dir` реально выбран;
- существуют ли `G.pkl`, `green.pkl`, `rail.pkl`;
- загрузились ли `green` и `rail` spatial-слои;
- доступны ли `pandas` и `geopandas`.

Если сервис на сервере начинает вести себя не так, как локально, первым делом нужно проверить именно этот endpoint.

## Структура маршрутизации

Сервис использует подготовленный граф и уже существующие ключи весов на ребрах графа, включая:

- `w_short`
- `w_quiet`
- `w_green`
- `w_accessible`
- `w_balanced`
- `w_balanced_v11`
- `w_quiet_v11`
- `w_green_v11`

Также используются производные атрибуты:

- `length_m`
- `noise_proxy_db`
- `noise_norm`
- `green_score`

## Текущая зафиксированная версия

- backend API version: `1.1.0`
- runtime service version: `vikway-v1.1.0`

## Примечания

- Если локально сервис работает правильно, а на сервере нет, нужно сравнивать не только код, но и runtime-окружение.
- Для Timeweb критично, чтобы контейнер реально был собран из актуального commit и содержал все зависимости из `backend/requirements.txt`.
- После деплоя полезно проверить:
  - `/api/health`
  - `/api/debug/runtime`

