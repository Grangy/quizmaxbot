// Многопоточный (конкурентный) парсер базы 4gk-base.andvarif.ru
// ТРЕБУЕТ Node.js 18+ (есть глобальный fetch).
//
// Делает:
// 1. GET https://andvarifserv.ru/tournaments/all-short  — список турниров
// 2. Параллельно тянет https://andvarifserv.ru/tournaments/{id} для опубликованных турниров
// 3. Собирает:
//    - ВСЕ вопросы (с картинками и без) в data/4gk_questions_all.json
//    - отдельный список вопросов, у которых есть картинка (поле `add` — URL)
// 4. Сохраняет:
//    - JSON с вопросами с картинками: data/4gk_questions_with_images.json
//    - JSON со всеми вопросами: data/4gk_questions_all.json
//    - Картинки: data/4gk_images/*

const fs = require('fs');
const path = require('path');

const API_BASE = 'https://andvarifserv.ru';

const DATA_DIR = path.join(__dirname, '..', 'data');
const OUT_JSON = path.join(DATA_DIR, '4gk_questions_with_images.json');
const OUT_JSON_ALL = path.join(DATA_DIR, '4gk_questions_all.json');
const IMAGES_DIR = path.join(DATA_DIR, '4gk_images');

// Ограничение одновременных запросов
const MAX_CONCURRENT_TOUR_REQUESTS = 8;
const MAX_CONCURRENT_IMAGE_DOWNLOADS = 6;

function ensureDirs() {
  if (!fs.existsSync(DATA_DIR)) {
    fs.mkdirSync(DATA_DIR, { recursive: true });
  }
  if (!fs.existsSync(IMAGES_DIR)) {
    fs.mkdirSync(IMAGES_DIR, { recursive: true });
  }
}

async function fetchJson(url) {
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`HTTP ${res.status} ${res.statusText} for ${url}`);
  }
  return res.json();
}

/**
 * Простое ограничение конкурентности.
 * items: массив задач
 * limit: максимум одновременных worker'ов
 * worker: async (item, index) => result
 */
async function runWithConcurrency(items, limit, worker) {
  const results = new Array(items.length);
  let index = 0;

  async function runWorker() {
    while (true) {
      const current = index++;
      if (current >= items.length) break;
      const item = items[current];
      try {
        results[current] = await worker(item, current);
      } catch (err) {
        console.error(`Ошибка при обработке элемента #${current}:`, err.message);
        results[current] = null;
      }
    }
  }

  const workers = [];
  const workerCount = Math.min(limit, items.length || 0);
  for (let i = 0; i < workerCount; i++) {
    workers.push(runWorker());
  }
  await Promise.all(workers);
  return results;
}

async function loadAllTournamentsShort() {
  console.log('Загружаю список турниров (all-short)...');
  const url = `${API_BASE}/tournaments/all-short`;
  const data = await fetchJson(url);
  console.log(`Всего турниров в all-short: ${data.length}`);
  return data;
}

async function loadTournamentFull(id) {
  const url = `${API_BASE}/tournaments/${id}`;
  return fetchJson(url);
}

function isImageUrl(value) {
  if (typeof value !== 'string') return false;
  if (!value.startsWith('http')) return false;
  // Базовая эвристика: jpg/png/gif/webp
  const lowered = value.toLowerCase();
  return (
    lowered.endsWith('.jpg') ||
    lowered.endsWith('.jpeg') ||
    lowered.endsWith('.png') ||
    lowered.endsWith('.gif') ||
    lowered.endsWith('.webp')
  );
}

async function downloadImage(task) {
  const { url, tournamentId, questionNumber } = task;
  try {
    const res = await fetch(url);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} ${res.statusText}`);
    }

    const arrayBuf = await res.arrayBuffer();
    const buf = Buffer.from(arrayBuf);

    const urlObj = new URL(url);
    const baseName = path.basename(urlObj.pathname) || 'image';
    const ext = path.extname(baseName) || '.jpg';
    const nameWithoutExt = path.basename(baseName, ext);

    const fileName = `t${tournamentId}_q${questionNumber}_${nameWithoutExt}${ext}`;
    const filePath = path.join(IMAGES_DIR, fileName);

    fs.writeFileSync(filePath, buf);
    return { url, fileName, ok: true };
  } catch (err) {
    console.error(`Не удалось скачать картинку ${url}: ${err.message}`);
    return { url, fileName: null, ok: false };
  }
}

async function main() {
  ensureDirs();

  const allShort = await loadAllTournamentsShort();
  const published = allShort.filter(t => t.status === 'published');
  console.log(`Опубликованных турниров: ${published.length}`);

  console.log('Загружаю полные данные турниров (параллельно)...');
  const fullTournaments = await runWithConcurrency(
    published,
    MAX_CONCURRENT_TOUR_REQUESTS,
    async (t) => {
      const data = await loadTournamentFull(t.id);
      console.log(`Турнир ${t.id}: "${t.title}", вопросов: ${data.questions ? data.questions.length : 0}`);
      return data;
    }
  );

  const questionsWithImages = [];
  const allQuestions = [];
  const imageTasks = [];

  for (const t of fullTournaments) {
    if (!t || !Array.isArray(t.questions)) continue;
    for (const q of t.questions) {
      if (!q) continue;

      const hasImage = isImageUrl(q.add);

      const base = {
        tournamentId: t.id,
        tournamentTitle: t.title,
        date: t.date,
        difficulty: t.difficulty,
        link: t.link,
        tours: t.tours,
        questionsQuantity: t.questionsQuantity,
        editors: t.editors || [],
        questionId: q.id,
        tourNumber: q.tourNumber,
        questionNumber: q.qNumber,
        text: q.text,
        answer: q.answer,
        altAnswer: q.alterAnswer,
        comment: q.comment,
        author: q.author,
        sourceLinks: (q.source || []).map(s => s.link),
        imageUrl: hasImage ? q.add : null,
        imageFile: null // заполним после скачивания
      };

      allQuestions.push(base);

      if (hasImage) {
        questionsWithImages.push(base);

        imageTasks.push({
          url: q.add,
          tournamentId: t.id,
          questionNumber: q.qNumber
        });
      }
    }
  }

  console.log(`Всего вопросов (все, включая без картинок): ${allQuestions.length}`);
  console.log(`Из них с картинками: ${questionsWithImages.length}`);

  // Скачиваем картинки
  const uniqueByKey = new Map(); // key: url -> task
  for (const task of imageTasks) {
    if (!uniqueByKey.has(task.url)) {
      uniqueByKey.set(task.url, task);
    }
  }
  const uniqueTasks = Array.from(uniqueByKey.values());
  console.log(`Уникальных картинок для скачивания: ${uniqueTasks.length}`);

  const downloadResults = await runWithConcurrency(
    uniqueTasks,
    MAX_CONCURRENT_IMAGE_DOWNLOADS,
    downloadImage
  );

  const urlToFile = new Map();
  for (const res of downloadResults) {
    if (res && res.ok && res.fileName) {
      urlToFile.set(res.url, res.fileName);
    }
  }

  // Проставляем локальные имена файлов в JSON
  for (const q of allQuestions) {
    if (!q.imageUrl) continue;
    const fileName = urlToFile.get(q.imageUrl) || null;
    q.imageFile = fileName;
  }

  fs.writeFileSync(OUT_JSON, JSON.stringify(questionsWithImages, null, 2), 'utf8');
  fs.writeFileSync(OUT_JSON_ALL, JSON.stringify(allQuestions, null, 2), 'utf8');
  console.log(`Готово. JSON (с картинками) сохранён в: ${OUT_JSON}`);
  console.log(`Готово. JSON (все вопросы) сохранён в: ${OUT_JSON_ALL}`);
  console.log(`Картинки сохранены в директорию: ${IMAGES_DIR}`);
}

main().catch(err => {
  console.error('Фатальная ошибка парсера:', err);
  process.exit(1);
});


