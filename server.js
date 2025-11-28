const express = require('express');
const cors = require('cors');
const path = require('path');
const fs = require('fs');

const app = express();
app.use(cors());
app.use(express.json());

// Загружаем данные из JSON файлов
const DATA_DIR = path.join(__dirname, 'RuBQ', 'RuBQ_2.0');

// Файл с вопросами 4gk и директория с картинками
const FOURGK_JSON = path.join(__dirname, 'data', '4gk_questions_with_images.json');
const FOURGK_IMAGES_DIR = path.join(__dirname, 'data', '4gk_images');

let questions = [];
let paragraphsDict = {};
let fourgkQuestions = [];

// Определение сложности вопросов по тегам (та же логика, что и в боте)
const DIFFICULTY_TAGS = {
    easy: ['1-hop', '0-hop'], // Простые вопросы
    medium: ['multi-constraint', 'qualifier-constraint', 'reverse', 'exclusion'], // Средние вопросы
    hard: ['multi-hop', 'count', 'ranking', 'duration', 'no_answer', 'qualifier-answer'] // Сложные вопросы
};

function getQuestionDifficulty(question) {
    if (!question.tags || question.tags.length === 0) {
        return 'medium';
    }
    const tags = question.tags;
    if (tags.some(tag => DIFFICULTY_TAGS.hard.includes(tag))) return 'hard';
    if (tags.some(tag => DIFFICULTY_TAGS.medium.includes(tag))) return 'medium';
    if (tags.some(tag => DIFFICULTY_TAGS.easy.includes(tag))) return 'easy';
    return 'medium';
}

function loadQuestions() {
    /** Загружает вопросы из тестового файла */
    const questionsFile = path.join(DATA_DIR, 'RuBQ_2.0_test.json');
    try {
        const data = fs.readFileSync(questionsFile, 'utf8');
        questions = JSON.parse(data);
        console.log(`Загружено ${questions.length} вопросов`);
    } catch (error) {
        console.error(`Ошибка загрузки вопросов из ${questionsFile}:`, error.message);
        questions = [];
    }
}

function loadParagraphs() {
    /** Загружает параграфы */
    const paragraphsFile = path.join(DATA_DIR, 'RuBQ_2.0_paragraphs.json');
    try {
        const data = fs.readFileSync(paragraphsFile, 'utf8');
        const paragraphs = JSON.parse(data);
        // Создаем словарь для быстрого доступа
        paragraphsDict = {};
        paragraphs.forEach(p => {
            paragraphsDict[p.uid] = p;
        });
        console.log(`Загружено ${paragraphs.length} параграфов`);
    } catch (error) {
        console.warn(`Предупреждение: Файл параграфов не найден в ${paragraphsFile}`);
        paragraphsDict = {};
    }
}

function load4gkQuestions() {
    /** Загружает вопросы 4gk с картинками из заранее подготовленного JSON */
    try {
        const data = fs.readFileSync(FOURGK_JSON, 'utf8');
        fourgkQuestions = JSON.parse(data);
        console.log(`Загружено ${fourgkQuestions.length} вопросов 4gk с картинками`);
    } catch (error) {
        console.warn(`Предупреждение: не удалось загрузить 4gk вопросы из ${FOURGK_JSON}: ${error.message}`);
        fourgkQuestions = [];
    }
}

function normalizeAnswer(str) {
    if (!str) return '';
    let s = String(str).toLowerCase().trim();
    // Убираем кавычки и точку/знаки в конце
    s = s.replace(/^["'«»„“`]+/g, '').replace(/["'«»„“`]+$/g, '');
    s = s.replace(/[.,!?;:]+$/g, '');
    // Сжимаем повторяющиеся пробелы
    s = s.replace(/\s+/g, ' ');
    return s.trim();
}

// Загружаем данные при старте
loadQuestions();
loadParagraphs();
load4gkQuestions();

// Статические файлы
app.use(express.static(__dirname));

// Главная страница
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

// Получить случайный вопрос (с optional фильтром по сложности: ?difficulty=easy|medium|hard|all)
app.get('/api/question/random', (req, res) => {
    if (questions.length === 0) {
        return res.status(500).json({ error: 'Вопросы не загружены' });
    }
    
    const difficulty = (req.query.difficulty || 'all').toLowerCase();
    let pool = questions;
    
    if (['easy', 'medium', 'hard'].includes(difficulty)) {
        const filtered = questions.filter(q => getQuestionDifficulty(q) === difficulty);
        // Если в датасете есть вопросы такой сложности — используем только их
        if (filtered.length > 0) {
            pool = filtered;
        }
    }
    
    if (pool.length === 0) {
        return res.status(500).json({ error: 'Нет доступных вопросов для заданной сложности' });
    }
    
    const question = pool[Math.floor(Math.random() * pool.length)];
    
    // Подготавливаем ответ для клиента (без правильных ответов)
    const questionData = {
        uid: question.uid,
        question_text: question.question_text,
        question_eng: question.question_eng || '',
        tags: question.tags || []
    };
    
    // Добавляем параграфы, если они есть
    if (question.paragraphs_uids) {
        const paraUids = question.paragraphs_uids.value || [];
        if (paraUids.length > 0) {
            // Берем первый параграф для подсказки
            const firstParaUid = paraUids[0];
            if (paragraphsDict[firstParaUid]) {
                const paraText = paragraphsDict[firstParaUid].text;
                questionData.hint_paragraph = paraText.substring(0, 500) + '...';
            }
        }
    }
    
    res.json(questionData);
});

// Получить вопрос по uid
app.get('/api/question/:uid', (req, res) => {
    const uid = parseInt(req.params.uid);
    const question = questions.find(q => q.uid === uid);
    
    if (!question) {
        return res.status(404).json({ error: 'Question not found' });
    }
    
    const questionData = {
        uid: question.uid,
        question_text: question.question_text,
        question_eng: question.question_eng || '',
        tags: question.tags || []
    };
    
    res.json(questionData);
});

// --- 4gk: вопросы ЧГК с картинками ---

// Получить случайный вопрос 4gk с картинкой
app.get('/api/4gk/random', (req, res) => {
    if (!fourgkQuestions || fourgkQuestions.length === 0) {
        return res.status(500).json({ error: 'Вопросы 4gk не загружены' });
    }

    const q = fourgkQuestions[Math.floor(Math.random() * fourgkQuestions.length)];

    const imagePath = q.imageFile
        ? `/data/4gk_images/${q.imageFile}`
        : q.imageUrl;

    res.json({
        id: q.questionId,
        text: q.text,
        tournamentTitle: q.tournamentTitle,
        tourNumber: q.tourNumber,
        questionNumber: q.questionNumber,
        imageUrl: imagePath,
        difficulty: q.difficulty,
        sourceLinks: q.sourceLinks || []
    });
});

// Проверить ответ на вопрос 4gk
app.post('/api/4gk/check-answer/:id', (req, res) => {
    const id = parseInt(req.params.id, 10);
    if (Number.isNaN(id)) {
        return res.status(400).json({ error: 'Некорректный id вопроса' });
    }

    if (!fourgkQuestions || fourgkQuestions.length === 0) {
        return res.status(500).json({ error: 'Вопросы 4gk не загружены' });
    }

    const question = fourgkQuestions.find(q => q.questionId === id);
    if (!question) {
        return res.status(404).json({ error: '4gk вопрос не найден' });
    }

    const userAnswerRaw = (req.body.answer || '').trim();
    const userAnswer = normalizeAnswer(userAnswerRaw);
    if (!userAnswer) {
        return res.status(400).json({ error: 'Пустой ответ' });
    }

    const candidates = [];
    if (question.answer) {
        candidates.push(question.answer);
    }
    if (question.altAnswer) {
        // Альтернативные ответы разделены ; или ,
        const parts = String(question.altAnswer).split(/[;,]/);
        parts.forEach(p => candidates.push(p));
    }

    const normalized = candidates
        .map(a => normalizeAnswer(a))
        .filter(a => a.length > 0);

    let isCorrect = false;
    let matched = null;

    for (const cand of normalized) {
        if (!cand) continue;
        if (userAnswer === cand || userAnswer.includes(cand) || cand.includes(userAnswer)) {
            isCorrect = true;
            matched = cand;
            break;
        }
    }

    res.json({
        correct: isCorrect,
        correct_answer: question.answer || '',
        alt_answers: question.altAnswer || '',
        matched_answer: matched
    });
});

// Проверить ответ
app.post('/api/check-answer/:uid', (req, res) => {
    const uid = parseInt(req.params.uid);
    const userAnswer = (req.body.answer || '').trim().toLowerCase();
    
    const question = questions.find(q => q.uid === uid);
    if (!question) {
        return res.status(404).json({ error: 'Question not found' });
    }
    
    // Получаем правильные ответы
    const correctAnswers = [];
    
    // Проверяем answer_text
    if (question.answer_text) {
        correctAnswers.push(question.answer_text.toLowerCase());
    }
    
    // Проверяем все варианты ответов
    if (question.answers) {
        question.answers.forEach(answer => {
            if (answer.type === 'uri') {
                // Добавляем label
                if (answer.label) {
                    correctAnswers.push(answer.label.toLowerCase());
                }
                // Добавляем все варианты имен из Wikidata
                if (answer.wd_names) {
                    ['ru', 'en'].forEach(lang => {
                        if (answer.wd_names[lang]) {
                            answer.wd_names[lang].forEach(name => {
                                correctAnswers.push(name.toLowerCase());
                            });
                        }
                    });
                }
                // Добавляем имена из Wikipedia
                if (answer.wp_names) {
                    answer.wp_names.forEach(name => {
                        correctAnswers.push(name.toLowerCase());
                    });
                }
            } else if (answer.type === 'literal') {
                // Для литералов проверяем value
                if (answer.value !== undefined) {
                    correctAnswers.push(String(answer.value).toLowerCase());
                }
            }
        });
    }
    
    // Убираем дубликаты
    const uniqueAnswers = [...new Set(correctAnswers)];
    
    // Проверяем ответ пользователя
    let isCorrect = false;
    let matchedAnswer = null;
    
    for (const correct of uniqueAnswers) {
        if (userAnswer === correct || userAnswer.includes(correct) || correct.includes(userAnswer)) {
            isCorrect = true;
            matchedAnswer = correct;
            break;
        }
    }
    
    // Показываем правильный ответ
    let displayAnswer = question.answer_text || '';
    if (!displayAnswer && question.answers && question.answers.length > 0) {
        const firstAnswer = question.answers[0];
        if (firstAnswer.type === 'uri' && firstAnswer.label) {
            displayAnswer = firstAnswer.label;
        } else if (firstAnswer.type === 'literal' && firstAnswer.value !== undefined) {
            displayAnswer = String(firstAnswer.value);
        }
    }
    
    res.json({
        correct: isCorrect,
        correct_answer: displayAnswer,
        matched_answer: matchedAnswer
    });
});

// Статистика по датасету
app.get('/api/stats', (req, res) => {
    res.json({
        total_questions: questions.length,
        tags: {}
    });
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Сервер запущен на http://localhost:${PORT}`);
});

