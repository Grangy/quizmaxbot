const TelegramBot = require('node-telegram-bot-api');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

const token = process.env.TELEGRAM_BOT_TOKEN;
if (!token) {
    console.error('Ошибка: TELEGRAM_BOT_TOKEN не найден в .env файле');
    process.exit(1);
}

const bot = new TelegramBot(token, { polling: true });

// Пути к файлам данных
const DATA_DIR = path.join(__dirname, 'RuBQ', 'RuBQ_2.0');
const DB_DIR = path.join(__dirname, 'data');
const USERS_DB = path.join(DB_DIR, 'users.json');
const RESULTS_DB = path.join(DB_DIR, 'results.json');
const LOGS_DB = path.join(DB_DIR, 'logs.json');
const DAILY_STATS_DB = path.join(DB_DIR, 'daily_stats.json');
const ACHIEVEMENTS_DB = path.join(DB_DIR, 'achievements.json');
const GROUPS_DB = path.join(DB_DIR, 'groups.json');
const QUESTION_HISTORY_DB = path.join(DB_DIR, 'question_history.json');

// Создаем директорию для данных если её нет
if (!fs.existsSync(DB_DIR)) {
    fs.mkdirSync(DB_DIR, { recursive: true });
}

// Загружаем данные
let questions = [];
let paragraphsDict = {};
let users = {};
let results = {};
let logs = [];
let dailyStats = {};
let achievements = {};
let groups = {};
let questionHistory = {};

// ========== УЛУЧШЕНИЕ 1: Система достижений ==========
const ACHIEVEMENTS = {
    FIRST_QUESTION: { name: '🎯 Первый шаг', desc: 'Ответить на первый вопрос' },
    PERFECT_10: { name: '🔥 Десятка', desc: '10 правильных ответов подряд' },
    PERFECT_50: { name: '⭐ Мастер', desc: '50 правильных ответов подряд' },
    HUNDRED_QUESTIONS: { name: '💯 Сотня', desc: 'Ответить на 100 вопросов' },
    PERFECT_DAY: { name: '📅 Идеальный день', desc: '30/30 правильных ответов за день' },
    WEEK_WARRIOR: { name: '⚔️ Воин недели', desc: 'Активность 7 дней подряд' },
    TOP_10: { name: '🏆 Топ-10', desc: 'Попасть в топ-10 игроков' },
    ACCURACY_90: { name: '🎯 Снайпер', desc: 'Точность выше 90%' },
    GROUP_LEADER: { name: '👑 Лидер группы', desc: 'Быть первым в группе' },
    EARLY_BIRD: { name: '🌅 Ранняя пташка', desc: 'Ответить на вопрос до 8 утра' }
};

// ========== УЛУЧШЕНИЕ 2: Кэширование вопросов для пользователей ==========
const userQuestionCache = {};
const MAX_CACHE_SIZE = 1000;

// ========== УЛУЧШЕНИЕ 3: Система рейтинга ==========
function calculateRating(user) {
    // Базовый рейтинг зависит от сложности вопросов
    let baseRating = 0;
    
    // Подсчитываем рейтинг на основе сложности отвеченных вопросов
    if (results[user.id] && results[user.id].length > 0) {
        results[user.id].forEach(result => {
            if (result.isCorrect) {
                // Множители в зависимости от сложности
                const difficultyMultipliers = {
                    'easy': 5,      // Легкие вопросы дают меньше рейтинга
                    'medium': 10,    // Средние - стандартный рейтинг
                    'hard': 20      // Сложные - в 2 раза больше
                };
                const multiplier = difficultyMultipliers[result.difficulty] || 10;
                baseRating += multiplier;
            }
        });
    } else {
        // Fallback для старых данных
        baseRating = user.correctAnswers * 10;
    }
    
    const streakBonus = user.bestStreak * 5;
    const accuracyBonus = user.totalQuestions > 0 ? Math.floor((user.correctAnswers / user.totalQuestions) * 100) * 2 : 0;
    return baseRating + streakBonus + accuracyBonus;
}

// Функции для работы с БД
function loadQuestions() {
    try {
        const data = fs.readFileSync(path.join(DATA_DIR, 'RuBQ_2.0_test.json'), 'utf8');
        questions = JSON.parse(data);
        console.log(`✅ Загружено ${questions.length} вопросов`);
    } catch (error) {
        console.error('❌ Ошибка загрузки вопросов:', error.message);
        questions = [];
    }
}

function loadParagraphs() {
    try {
        const data = fs.readFileSync(path.join(DATA_DIR, 'RuBQ_2.0_paragraphs.json'), 'utf8');
        const paragraphs = JSON.parse(data);
        paragraphsDict = {};
        paragraphs.forEach(p => {
            paragraphsDict[p.uid] = p;
        });
        console.log(`✅ Загружено ${paragraphs.length} параграфов`);
    } catch (error) {
        console.warn('⚠️ Параграфы не загружены');
        paragraphsDict = {};
    }
}

function loadUsers() {
    try {
        if (fs.existsSync(USERS_DB)) {
            users = JSON.parse(fs.readFileSync(USERS_DB, 'utf8'));
            // Миграция: инициализируем level, experience и difficulty для существующих пользователей
            let needsSave = false;
            for (const userId in users) {
                const user = users[userId];
                if (user.level === undefined || user.level === null || user.level < 1) {
                    user.level = 1;
                    needsSave = true;
                }
                if (user.level > MAX_LEVEL) {
                    user.level = MAX_LEVEL;
                    needsSave = true;
                }
                if (user.experience === undefined || user.experience === null) {
                    user.experience = 0;
                    needsSave = true;
                }
                if (user.difficulty === undefined || user.difficulty === null) {
                    user.difficulty = 'all';
                    needsSave = true;
                }
            }
            if (needsSave) {
                saveUsers();
                console.log('✅ Выполнена миграция данных пользователей');
            }
        }
    } catch (error) {
        console.error('Ошибка загрузки пользователей:', error.message);
        users = {};
    }
}

function saveUsers() {
    try {
        fs.writeFileSync(USERS_DB, JSON.stringify(users, null, 2), 'utf8');
    } catch (error) {
        console.error('Ошибка сохранения пользователей:', error.message);
    }
}

function loadResults() {
    try {
        if (fs.existsSync(RESULTS_DB)) {
            results = JSON.parse(fs.readFileSync(RESULTS_DB, 'utf8'));
        }
    } catch (error) {
        console.error('Ошибка загрузки результатов:', error.message);
        results = {};
    }
}

function saveResults() {
    try {
        fs.writeFileSync(RESULTS_DB, JSON.stringify(results, null, 2), 'utf8');
    } catch (error) {
        console.error('Ошибка сохранения результатов:', error.message);
    }
}

function loadLogs() {
    try {
        if (fs.existsSync(LOGS_DB)) {
            logs = JSON.parse(fs.readFileSync(LOGS_DB, 'utf8'));
        }
    } catch (error) {
        console.error('Ошибка загрузки логов:', error.message);
        logs = [];
    }
}

function saveLogs() {
    try {
        const MAX_LOG_SIZE_MB = 5;
        const MAX_LOG_SIZE_BYTES = MAX_LOG_SIZE_MB * 1024 * 1024; // 5 МБ в байтах
        
        // Сначала пробуем сохранить текущие логи
        let jsonString = JSON.stringify(logs, null, 2);
        let fileSize = Buffer.byteLength(jsonString, 'utf8');
        
        // Если размер превышает лимит, удаляем старые записи
        while (fileSize > MAX_LOG_SIZE_BYTES && logs.length > 0) {
            // Удаляем 10% самых старых записей
            const removeCount = Math.max(1, Math.floor(logs.length * 0.1));
            logs = logs.slice(removeCount);
            
            // Пересчитываем размер
            jsonString = JSON.stringify(logs, null, 2);
            fileSize = Buffer.byteLength(jsonString, 'utf8');
        }
        
        // Дополнительная проверка: если всё ещё слишком большой, оставляем только последние 5000 записей
        if (fileSize > MAX_LOG_SIZE_BYTES && logs.length > 5000) {
            logs = logs.slice(-5000);
            jsonString = JSON.stringify(logs, null, 2);
            fileSize = Buffer.byteLength(jsonString, 'utf8');
        }
        
        // Если всё ещё слишком большой, используем компактный формат (без отступов)
        if (fileSize > MAX_LOG_SIZE_BYTES) {
            jsonString = JSON.stringify(logs);
            fileSize = Buffer.byteLength(jsonString, 'utf8');
            
            // Если и это не помогло, удаляем записи до нужного размера
            while (fileSize > MAX_LOG_SIZE_BYTES && logs.length > 0) {
                logs = logs.slice(1); // Удаляем самую старую запись
                jsonString = JSON.stringify(logs);
                fileSize = Buffer.byteLength(jsonString, 'utf8');
            }
        }
        
        fs.writeFileSync(LOGS_DB, jsonString, 'utf8');
        
        // Логируем информацию о размере (только если размер близок к лимиту)
        if (fileSize > MAX_LOG_SIZE_BYTES * 0.8) {
            console.log(`⚠️ Размер логов: ${(fileSize / 1024 / 1024).toFixed(2)} МБ (лимит: ${MAX_LOG_SIZE_MB} МБ)`);
        }
    } catch (error) {
        console.error('Ошибка сохранения логов:', error.message);
    }
}

function loadDailyStats() {
    try {
        if (fs.existsSync(DAILY_STATS_DB)) {
            dailyStats = JSON.parse(fs.readFileSync(DAILY_STATS_DB, 'utf8'));
        }
    } catch (error) {
        console.error('Ошибка загрузки дневной статистики:', error.message);
        dailyStats = {};
    }
}

function saveDailyStats() {
    try {
        fs.writeFileSync(DAILY_STATS_DB, JSON.stringify(dailyStats, null, 2), 'utf8');
    } catch (error) {
        console.error('Ошибка сохранения дневной статистики:', error.message);
    }
}

// ========== УЛУЧШЕНИЕ 4: Загрузка достижений ==========
function loadAchievements() {
    try {
        if (fs.existsSync(ACHIEVEMENTS_DB)) {
            achievements = JSON.parse(fs.readFileSync(ACHIEVEMENTS_DB, 'utf8'));
        }
    } catch (error) {
        achievements = {};
    }
}

function saveAchievements() {
    try {
        fs.writeFileSync(ACHIEVEMENTS_DB, JSON.stringify(achievements, null, 2), 'utf8');
    } catch (error) {
        console.error('Ошибка сохранения достижений:', error.message);
    }
}

// ========== УЛУЧШЕНИЕ 5: Загрузка групп ==========
function loadGroups() {
    try {
        if (fs.existsSync(GROUPS_DB)) {
            groups = JSON.parse(fs.readFileSync(GROUPS_DB, 'utf8'));
        }
    } catch (error) {
        groups = {};
    }
}

function saveGroups() {
    try {
        fs.writeFileSync(GROUPS_DB, JSON.stringify(groups, null, 2), 'utf8');
    } catch (error) {
        console.error('Ошибка сохранения групп:', error.message);
    }
}

// ========== УЛУЧШЕНИЕ 6: История вопросов для избежания повторов ==========
function loadQuestionHistory() {
    try {
        if (fs.existsSync(QUESTION_HISTORY_DB)) {
            questionHistory = JSON.parse(fs.readFileSync(QUESTION_HISTORY_DB, 'utf8'));
        }
    } catch (error) {
        questionHistory = {};
    }
}

function saveQuestionHistory() {
    try {
        fs.writeFileSync(QUESTION_HISTORY_DB, JSON.stringify(questionHistory, null, 2), 'utf8');
    } catch (error) {
        console.error('Ошибка сохранения истории вопросов:', error.message);
    }
}

function getToday() {
    return new Date().toISOString().split('T')[0];
}

function getUserDailyCount(userId) {
    const today = getToday();
    const key = `${userId}_${today}`;
    return dailyStats[key] || 0;
}

function incrementDailyCount(userId) {
    const today = getToday();
    const key = `${userId}_${today}`;
    dailyStats[key] = (dailyStats[key] || 0) + 1;
    saveDailyStats();
}

function canAnswerMore(userId) {
    return getUserDailyCount(userId) < 30;
}

// ========== УЛУЧШЕНИЕ 7: Проверка достижений ==========
function checkAchievements(userId) {
    const user = users[userId];
    if (!user) return [];
    
    const newAchievements = [];
    
    if (!achievements[userId]) {
        achievements[userId] = [];
    }
    
    // Первый вопрос
    if (user.totalQuestions === 1 && !achievements[userId].includes('FIRST_QUESTION')) {
        achievements[userId].push('FIRST_QUESTION');
        newAchievements.push('FIRST_QUESTION');
    }
    
    // Серия 10
    if (user.streak >= 10 && !achievements[userId].includes('PERFECT_10')) {
        achievements[userId].push('PERFECT_10');
        newAchievements.push('PERFECT_10');
    }
    
    // Серия 50
    if (user.streak >= 50 && !achievements[userId].includes('PERFECT_50')) {
        achievements[userId].push('PERFECT_50');
        newAchievements.push('PERFECT_50');
    }
    
    // 100 вопросов
    if (user.totalQuestions >= 100 && !achievements[userId].includes('HUNDRED_QUESTIONS')) {
        achievements[userId].push('HUNDRED_QUESTIONS');
        newAchievements.push('HUNDRED_QUESTIONS');
    }
    
    // Идеальный день
    const today = getToday();
    const todayCorrect = getUserDailyCorrect(userId, today);
    if (todayCorrect === 30 && getUserDailyCount(userId) === 30 && !achievements[userId].includes('PERFECT_DAY')) {
        achievements[userId].push('PERFECT_DAY');
        newAchievements.push('PERFECT_DAY');
    }
    
    // Точность 90%
    const accuracy = user.totalQuestions > 0 ? (user.correctAnswers / user.totalQuestions) * 100 : 0;
    if (accuracy >= 90 && user.totalQuestions >= 20 && !achievements[userId].includes('ACCURACY_90')) {
        achievements[userId].push('ACCURACY_90');
        newAchievements.push('ACCURACY_90');
    }
    
    // Топ-10
    const topUsers = getTopUsers(10);
    if (topUsers.some(u => u.id === userId) && !achievements[userId].includes('TOP_10')) {
        achievements[userId].push('TOP_10');
        newAchievements.push('TOP_10');
    }
    
    if (newAchievements.length > 0) {
        saveAchievements();
    }
    
    return newAchievements;
}

function getUserDailyCorrect(userId, date) {
    if (!results[userId]) return 0;
    return results[userId].filter(r => {
        const resultDate = new Date(r.date).toISOString().split('T')[0];
        return resultDate === date && r.isCorrect;
    }).length;
}

function registerUser(msg) {
    const userId = msg.from.id;
    const chatId = msg.chat.id;
    const isGroup = msg.chat.type !== 'private';
    
    if (!users[userId]) {
        users[userId] = {
            id: userId,
            firstName: msg.from.first_name || '',
            lastName: msg.from.last_name || '',
            username: msg.from.username || '',
            registeredAt: new Date().toISOString(),
            chats: [chatId],
            isGroupMember: isGroup,
            totalQuestions: 0,
            correctAnswers: 0,
            streak: 0,
            bestStreak: 0,
            lastQuestionDate: null,
            rating: 0,
            consecutiveDays: 1,
            lastActiveDate: getToday(),
            favoriteCategory: null,
            level: 1,
            experience: 0,
            difficulty: 'all' // all, easy, medium, hard
        };
        saveUsers();
    } else {
        if (!users[userId].chats.includes(chatId)) {
            users[userId].chats.push(chatId);
            saveUsers();
        }
        // ========== УЛУЧШЕНИЕ 8: Отслеживание последовательных дней ==========
        const today = getToday();
        const lastActive = users[userId].lastActiveDate;
        if (lastActive === today) {
            // Уже активен сегодня
        } else {
            const yesterday = new Date();
            yesterday.setDate(yesterday.getDate() - 1);
            const yesterdayStr = yesterday.toISOString().split('T')[0];
            if (lastActive === yesterdayStr) {
                users[userId].consecutiveDays++;
            } else {
                users[userId].consecutiveDays = 1;
            }
            users[userId].lastActiveDate = today;
            saveUsers();
        }
    }
    
    // ========== УЛУЧШЕНИЕ 9: Регистрация группы ==========
    if (isGroup && !groups[chatId]) {
        groups[chatId] = {
            id: chatId,
            title: msg.chat.title || 'Группа',
            members: [userId],
            createdAt: new Date().toISOString(),
            totalQuestions: 0,
            leaderboard: {}
        };
        saveGroups();
    } else if (isGroup && groups[chatId] && !groups[chatId].members.includes(userId)) {
        groups[chatId].members.push(userId);
        saveGroups();
    }
    
    return users[userId];
}

function logAnswer(userId, questionId, userAnswer, isCorrect, correctAnswer, chatId) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        userId,
        chatId,
        questionId,
        userAnswer,
        isCorrect,
        correctAnswer,
        userName: users[userId] ? `${users[userId].firstName} ${users[userId].lastName}`.trim() : 'Unknown',
        isGroup: chatId < 0
    };
    logs.push(logEntry);
    saveLogs();
}

// ========== УЛУЧШЕНИЕ 10: Умный выбор вопросов (избегание повторов) ==========
// Определение сложности вопросов по тегам
const DIFFICULTY_TAGS = {
    easy: ['1-hop', '0-hop'], // Простые вопросы
    medium: ['multi-constraint', 'qualifier-constraint', 'reverse', 'exclusion'], // Средние вопросы
    hard: ['multi-hop', 'count', 'ranking', 'duration', 'no_answer', 'qualifier-answer'] // Сложные вопросы
};

function getQuestionDifficulty(question) {
    if (!question.tags || question.tags.length === 0) {
        return 'medium'; // По умолчанию средняя сложность
    }
    
    const tags = question.tags;
    
    // Проверяем сложные теги
    if (tags.some(tag => DIFFICULTY_TAGS.hard.includes(tag))) {
        return 'hard';
    }
    
    // Проверяем средние теги
    if (tags.some(tag => DIFFICULTY_TAGS.medium.includes(tag))) {
        return 'medium';
    }
    
    // Проверяем простые теги
    if (tags.some(tag => DIFFICULTY_TAGS.easy.includes(tag))) {
        return 'easy';
    }
    
    return 'medium'; // По умолчанию
}

function getRandomQuestion(userId) {
    if (questions.length === 0) return null;
    
    // Получаем настройку сложности пользователя
    const user = users[userId];
    const difficulty = (user && user.difficulty) || 'all'; // all, easy, medium, hard
    
    // Получаем историю вопросов пользователя
    if (!questionHistory[userId]) {
        questionHistory[userId] = [];
    }
    
    // Фильтруем уже заданные вопросы (последние 50)
    const recentQuestions = questionHistory[userId].slice(-50);
    let availableQuestions = questions.filter(q => !recentQuestions.includes(q.uid));
    
    // Фильтруем по сложности, если не "all"
    if (difficulty !== 'all') {
        availableQuestions = availableQuestions.filter(q => {
            const qDifficulty = getQuestionDifficulty(q);
            return qDifficulty === difficulty;
        });
    }
    
    // Если после фильтрации нет вопросов, используем все доступные
    const questionPool = availableQuestions.length > 0 ? availableQuestions : questions;
    
    // Если все еще нет вопросов, сбрасываем фильтр по истории
    if (questionPool.length === 0) {
        const allQuestions = difficulty !== 'all' 
            ? questions.filter(q => getQuestionDifficulty(q) === difficulty)
            : questions;
        const question = allQuestions[Math.floor(Math.random() * allQuestions.length)];
        if (question) {
            questionHistory[userId].push(question.uid);
            if (questionHistory[userId].length > 100) {
                questionHistory[userId] = questionHistory[userId].slice(-100);
            }
            saveQuestionHistory();
            return question;
        }
        return null;
    }
    
    const question = questionPool[Math.floor(Math.random() * questionPool.length)];
    
    // Добавляем в историю
    questionHistory[userId].push(question.uid);
    if (questionHistory[userId].length > 100) {
        questionHistory[userId] = questionHistory[userId].slice(-100);
    }
    saveQuestionHistory();
    
    return question;
}

function checkAnswer(question, userAnswer) {
    const userAns = userAnswer.trim().toLowerCase();
    const correctAnswers = [];
    
    if (question.answer_text) {
        correctAnswers.push(question.answer_text.toLowerCase());
    }
    
    if (question.answers) {
        question.answers.forEach(answer => {
            if (answer.type === 'uri') {
                if (answer.label) correctAnswers.push(answer.label.toLowerCase());
                if (answer.wd_names) {
                    ['ru', 'en'].forEach(lang => {
                        if (answer.wd_names[lang]) {
                            answer.wd_names[lang].forEach(name => {
                                correctAnswers.push(name.toLowerCase());
                            });
                        }
                    });
                }
                if (answer.wp_names) {
                    answer.wp_names.forEach(name => {
                        correctAnswers.push(name.toLowerCase());
                    });
                }
            } else if (answer.type === 'literal') {
                if (answer.value !== undefined) {
                    correctAnswers.push(String(answer.value).toLowerCase());
                }
            }
        });
    }
    
    const uniqueAnswers = [...new Set(correctAnswers)];
    
    for (const correct of uniqueAnswers) {
        if (userAns === correct || userAns.includes(correct) || correct.includes(userAns)) {
            let displayAnswer = question.answer_text || '';
            if (!displayAnswer && question.answers && question.answers.length > 0) {
                const firstAnswer = question.answers[0];
                if (firstAnswer.type === 'uri' && firstAnswer.label) {
                    displayAnswer = firstAnswer.label;
                } else if (firstAnswer.type === 'literal' && firstAnswer.value !== undefined) {
                    displayAnswer = String(firstAnswer.value);
                }
            }
            return { isCorrect: true, correctAnswer: displayAnswer };
        }
    }
    
    let displayAnswer = question.answer_text || '';
    if (!displayAnswer && question.answers && question.answers.length > 0) {
        const firstAnswer = question.answers[0];
        if (firstAnswer.type === 'uri' && firstAnswer.label) {
            displayAnswer = firstAnswer.label;
        } else if (firstAnswer.type === 'literal' && firstAnswer.value !== undefined) {
            displayAnswer = String(firstAnswer.value);
        }
    }
    
    return { isCorrect: false, correctAnswer: displayAnswer };
}

// ========== УЛУЧШЕНИЕ 11: Система уровней и опыта (20 уровней) ==========
const MAX_LEVEL = 20;

// Смешные названия уровней от слабого к сильному
const LEVEL_NAMES = {
    1: '🐛 Гусеница',
    2: '🐌 Улитка',
    3: '🐭 Мышь',
    4: '🐰 Кролик',
    5: '🐱 Кот',
    6: '🐶 Собака',
    7: '🐺 Волк',
    8: '🦊 Лиса',
    9: '🐻 Медведь',
    10: '🐯 Тигр',
    11: '🦁 Лев',
    12: '🐉 Дракон',
    13: '🦅 Орел',
    14: '🦈 Акула',
    15: '🐘 Слон',
    16: '🦏 Носорог',
    17: '🦍 Горилла',
    18: '🐲 Дракон-Повелитель',
    19: '👑 Король Зверей',
    20: '🌟 БОГ ВИКТОРИНЫ'
};

function getLevelName(level) {
    if (level < 1) return LEVEL_NAMES[1];
    if (level > MAX_LEVEL) return LEVEL_NAMES[MAX_LEVEL];
    return LEVEL_NAMES[level] || `Уровень ${level}`;
}

function getExpForLevel(level) {
    // Формула: уровень * 100 опыта
    // Уровень 1: 100 опыта
    // Уровень 2: 200 опыта
    // Уровень 3: 300 опыта
    // ...
    // Уровень 20: 2000 опыта (максимум)
    return level * 100;
}

function addExperience(userId, isCorrect, questionDifficulty = 'medium') {
    const user = users[userId];
    if (!user) return false;
    
    // Если уже максимальный уровень, не даем опыт
    if (user.level >= MAX_LEVEL) {
        return false;
    }
    
    // Инициализируем опыт если его нет
    if (user.experience === undefined || user.experience === null) {
        user.experience = 0;
    }
    
    // Инициализируем уровень если его нет
    if (user.level === undefined || user.level === null || user.level < 1) {
        user.level = 1;
    }
    
    // Опыт зависит от сложности вопроса
    const difficultyExpMultipliers = {
        'easy': { correct: 5, incorrect: 1 },      // Легкие дают меньше опыта
        'medium': { correct: 10, incorrect: 2 },  // Средние - стандартный опыт
        'hard': { correct: 20, incorrect: 4 }     // Сложные - в 2 раза больше
    };
    
    const multipliers = difficultyExpMultipliers[questionDifficulty] || difficultyExpMultipliers['medium'];
    const expGain = isCorrect ? multipliers.correct : multipliers.incorrect;
    user.experience += expGain;
    
    const expForNextLevel = getExpForLevel(user.level);
    
    // Проверяем повышение уровня
    if (user.experience >= expForNextLevel && user.level < MAX_LEVEL) {
        const remainingExp = user.experience - expForNextLevel;
        user.level++;
        user.experience = remainingExp; // Сохраняем остаток опыта
        return true; // Уровень повышен
    }
    
    return false;
}

function updateUserStats(userId, isCorrect, chatId, question = null) {
    if (!users[userId]) return false;
    
    const user = users[userId];
    user.totalQuestions++;
    
    // Определяем сложность вопроса
    const questionDifficulty = question ? getQuestionDifficulty(question) : 'medium';
    
    const leveledUp = addExperience(userId, isCorrect, questionDifficulty);
    
    if (isCorrect) {
        user.correctAnswers++;
        user.streak++;
        if (user.streak > user.bestStreak) {
            user.bestStreak = user.streak;
        }
    } else {
        user.streak = 0;
    }
    
    user.rating = calculateRating(user);
    user.lastQuestionDate = new Date().toISOString();
    saveUsers();
    
    if (!results[userId]) {
        results[userId] = [];
    }
    results[userId].push({
        date: new Date().toISOString(),
        isCorrect,
        questionId: user.currentQuestionId,
        chatId,
        difficulty: questionDifficulty // Сохраняем сложность вопроса
    });
    saveResults();
    
    // ========== УЛУЧШЕНИЕ 12: Обновление статистики группы ==========
    if (chatId < 0 && groups[chatId]) {
        groups[chatId].totalQuestions++;
        if (!groups[chatId].leaderboard[userId]) {
            groups[chatId].leaderboard[userId] = { correct: 0, total: 0 };
        }
        groups[chatId].leaderboard[userId].total++;
        if (isCorrect) {
            groups[chatId].leaderboard[userId].correct++;
        }
        saveGroups();
    }
    
    return { leveledUp, difficulty: questionDifficulty };
}

function getTopUsers(limit = 10, sortBy = 'rating') {
    return Object.values(users)
        .sort((a, b) => {
            if (sortBy === 'rating') {
                return calculateRating(b) - calculateRating(a);
            } else if (sortBy === 'accuracy') {
                const aPercent = a.totalQuestions > 0 ? (a.correctAnswers / a.totalQuestions) * 100 : 0;
                const bPercent = b.totalQuestions > 0 ? (b.correctAnswers / b.totalQuestions) * 100 : 0;
                if (Math.abs(aPercent - bPercent) > 0.1) {
                    return bPercent - aPercent;
                }
                return b.totalQuestions - a.totalQuestions;
            } else {
                return b.totalQuestions - a.totalQuestions;
            }
        })
        .slice(0, limit);
}

function getUserStats(userId) {
    const user = users[userId];
    if (!user) return null;
    
    // Инициализируем уровень и опыт если их нет
    if (user.level === undefined || user.level === null || user.level < 1) {
        user.level = 1;
    }
    if (user.experience === undefined || user.experience === null) {
        user.experience = 0;
    }
    
    // Ограничиваем уровень максимумом
    if (user.level > MAX_LEVEL) {
        user.level = MAX_LEVEL;
    }
    
    const accuracy = user.totalQuestions > 0 
        ? Math.round((user.correctAnswers / user.totalQuestions) * 100) 
        : 0;
    
    let expForNextLevel = 0;
    let progress = 0;
    
    if (user.level < MAX_LEVEL) {
        expForNextLevel = getExpForLevel(user.level);
        if (expForNextLevel > 0) {
            progress = Math.round((user.experience / expForNextLevel) * 100);
            // Ограничиваем прогресс 0-100%
            progress = Math.max(0, Math.min(100, progress));
        }
    } else {
        // Максимальный уровень
        expForNextLevel = getExpForLevel(MAX_LEVEL);
        progress = 100;
    }
    
    return {
        name: `${user.firstName} ${user.lastName}`.trim() || user.username || `User ${userId}`,
        totalQuestions: user.totalQuestions || 0,
        correctAnswers: user.correctAnswers || 0,
        accuracy,
        streak: user.streak || 0,
        bestStreak: user.bestStreak || 0,
        todayQuestions: getUserDailyCount(userId),
        remainingToday: 30 - getUserDailyCount(userId),
        rating: calculateRating(user),
        level: user.level,
        experience: user.experience || 0,
        expForNextLevel,
        progress,
        consecutiveDays: user.consecutiveDays || 1,
        achievements: achievements[userId] || []
    };
}

// Хранилище текущих вопросов пользователей
const userCurrentQuestions = {};
// Хранилище последних отвеченных вопросов (для показа параграфов)
const userLastAnsweredQuestions = {};
// Хранилище текущих индексов параграфов для пользователей
const userParagraphIndices = {};
// Хранилище таймеров для вопросов (25 секунд)
const questionTimers = {};
const QUESTION_TIME_LIMIT = 25000; // 25 секунд в миллисекундах
const WARNING_TIME = 15000; // Предупреждение за 10 секунд до окончания (15 секунд)

// Загружаем данные при старте
loadQuestions();
loadParagraphs();
loadUsers();
loadResults();
loadLogs();
loadDailyStats();
loadAchievements();
loadGroups();
loadQuestionHistory();

console.log('🤖 Бот запущен!');

// ========== УЛУЧШЕНИЕ 13: Команда /achievements ==========
bot.onText(/\/achievements/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const userAchievements = achievements[userId] || [];
    
    if (userAchievements.length === 0) {
        bot.sendMessage(chatId, '🎖️ У вас пока нет достижений. Продолжайте играть!');
        return;
    }
    
    let text = '🎖️ <b>Ваши достижения:</b>\n\n';
    userAchievements.forEach(ach => {
        const achData = ACHIEVEMENTS[ach];
        if (achData) {
            text += `${achData.name}\n<i>${achData.desc}</i>\n\n`;
        }
    });
    
    bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
});

// ========== УЛУЧШЕНИЕ 14: Команда /groupstats для групп ==========
bot.onText(/\/groupstats/, (msg) => {
    const chatId = msg.chat.id;
    if (msg.chat.type === 'private') {
        bot.sendMessage(chatId, '❌ Эта команда работает только в группах.');
        return;
    }
    
    if (!groups[chatId] || Object.keys(groups[chatId].leaderboard).length === 0) {
        bot.sendMessage(chatId, '📊 В этой группе пока нет статистики.');
        return;
    }
    
    const leaderboard = groups[chatId].leaderboard;
    const sorted = Object.entries(leaderboard)
        .sort((a, b) => {
            const aPercent = a[1].total > 0 ? (a[1].correct / a[1].total) * 100 : 0;
            const bPercent = b[1].total > 0 ? (b[1].correct / b[1].total) * 100 : 0;
            if (Math.abs(aPercent - bPercent) > 0.1) {
                return bPercent - aPercent;
            }
            return b[1].total - a[1].total;
        })
        .slice(0, 10);
    
    let text = `📊 <b>Статистика группы "${groups[chatId].title}"</b>\n\n`;
    sorted.forEach(([userId, stats], index) => {
        const user = users[userId];
        const name = user ? `${user.firstName} ${user.lastName}`.trim() || user.username : `User ${userId}`;
        const accuracy = stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        text += `${medal} ${name}\n   ✅ ${stats.correct}/${stats.total} (${accuracy}%)\n\n`;
    });
    
    bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
});

// Команда /start
bot.onText(/\/start/, (msg) => {
    const chatId = msg.chat.id;
    const user = registerUser(msg);
    
    const welcomeText = `👋 Привет, ${user.firstName || 'друг'}!

🎯 Я бот для викторины RuBQ 2.0!

📚 Я задаю вопросы из базы знаний, а ты отвечаешь.
📊 Ты можешь решить до 30 вопросов в день.

🎮 Используй команды:
/start - Начать
/question - Новый вопрос
/top - Топ игроков
/stats - Твоя статистика
/achievements - Достижения
/difficulty - Настроить сложность
/help - Помощь

💡 <b>Система сложности:</b>
🟢 Легкие вопросы дают меньше опыта и рейтинга
🟡 Средние вопросы - стандартные награды
🔴 Сложные вопросы дают в 2 раза больше!

Готов начать? Нажми кнопку ниже! 👇`;
    
    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🎯 Начать викторину', callback_data: 'new_question' }],
                [{ text: '📊 Моя статистика', callback_data: 'my_stats' }, { text: '🏆 Топ игроков', callback_data: 'top_players' }],
                [{ text: '🎖️ Достижения', callback_data: 'my_achievements' }, { text: '❓ Помощь', callback_data: 'help' }]
            ]
        }
    };
    
    bot.sendMessage(chatId, welcomeText, keyboard);
});

// Команда /question
bot.onText(/\/question/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    
    if (!canAnswerMore(userId)) {
        bot.sendMessage(chatId, `❌ Вы уже ответили на 30 вопросов сегодня!\n\n🕐 Лимит обновится завтра.`);
        return;
    }
    
    sendQuestion(chatId, userId);
});

// Команда /top
bot.onText(/\/top/, (msg) => {
    const chatId = msg.chat.id;
    showTopPlayers(chatId);
});

// Команда /stats
bot.onText(/\/stats/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    showUserStats(chatId, userId);
});

// Команда /difficulty - настройка сложности вопросов
bot.onText(/\/difficulty/, (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    registerUser(msg);
    
    const user = users[userId];
    const currentDifficulty = user.difficulty || 'all';
    
    const difficultyNames = {
        'all': '🌐 Все вопросы',
        'easy': '🟢 Легкие (1-hop, 0-hop)',
        'medium': '🟡 Средние (multi-constraint, reverse и др.)',
        'hard': '🔴 Сложные (multi-hop, count, ranking и др.)'
    };
    
    const text = `⚙️ <b>Настройка сложности вопросов</b>\n\n` +
        `Текущий уровень: <b>${difficultyNames[currentDifficulty]}</b>\n\n` +
        `Выберите уровень сложности:`;
    
    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: currentDifficulty === 'all' ? '✅ ' : '' + difficultyNames['all'], callback_data: 'set_difficulty_all' }],
                [{ text: currentDifficulty === 'easy' ? '✅ ' : '' + difficultyNames['easy'], callback_data: 'set_difficulty_easy' }],
                [{ text: currentDifficulty === 'medium' ? '✅ ' : '' + difficultyNames['medium'], callback_data: 'set_difficulty_medium' }],
                [{ text: currentDifficulty === 'hard' ? '✅ ' : '' + difficultyNames['hard'], callback_data: 'set_difficulty_hard' }],
                [{ text: '🏠 Выйти в меню', callback_data: 'main_menu' }]
            ]
        }
    };
    
    bot.sendMessage(chatId, text, { ...keyboard, parse_mode: 'HTML' });
});

// Команда /help
bot.onText(/\/help/, (msg) => {
    const chatId = msg.chat.id;
    const helpText = `📖 <b>Помощь по боту</b>

<b>Команды:</b>
/start - Начать работу с ботом
/question - Получить новый вопрос
/top - Посмотреть топ игроков
/stats - Ваша статистика
/achievements - Ваши достижения
/difficulty - Настроить сложность вопросов
/groupstats - Статистика группы (только в группах)
/help - Эта справка

<b>Правила:</b>
• Вы можете ответить на 30 вопросов в день
• Ответы проверяются автоматически
• Ваша статистика сохраняется
• Зарабатывайте опыт и повышайте уровень!
• Используйте /difficulty для выбора уровня сложности

<b>Система наград по сложности:</b>
🟢 <b>Легкие вопросы:</b> +5 опыта (правильно), +5 рейтинга
🟡 <b>Средние вопросы:</b> +10 опыта (правильно), +10 рейтинга
🔴 <b>Сложные вопросы:</b> +20 опыта (правильно), +20 рейтинга

<i>Сложные вопросы дают в 2 раза больше наград!</i>

<b>Управление:</b>
Используйте кнопки под сообщениями для навигации.

<b>Группы:</b>
Бот работает в группах! Используйте /groupstats для статистики группы.`;
    
    bot.sendMessage(chatId, helpText, { parse_mode: 'HTML' });
});

// Обработка callback кнопок
bot.on('callback_query', (query) => {
    const chatId = query.message.chat.id;
    const userId = query.from.id;
    const data = query.data;
    
    bot.answerCallbackQuery(query.id);
    
    switch (data) {
        case 'new_question': {
            if (!canAnswerMore(userId)) {
                bot.sendMessage(chatId, `❌ Вы уже ответили на 30 вопросов сегодня!\n\n🕐 Лимит обновится завтра.`);
                return;
            }
            sendQuestion(chatId, userId);
            break;
        }
        case 'my_stats': {
            showUserStats(chatId, userId);
            break;
        }
        case 'top_players': {
            showTopPlayers(chatId);
            break;
        }
        case 'my_achievements': {
            const userAchievements = achievements[userId] || [];
            if (userAchievements.length === 0) {
                bot.sendMessage(chatId, '🎖️ У вас пока нет достижений. Продолжайте играть!');
            } else {
                let text = '🎖️ <b>Ваши достижения:</b>\n\n';
                userAchievements.forEach(ach => {
                    const achData = ACHIEVEMENTS[ach];
                    if (achData) {
                        text += `${achData.name}\n<i>${achData.desc}</i>\n\n`;
                    }
                });
                bot.sendMessage(chatId, text, { parse_mode: 'HTML' });
            }
            break;
        }
        case 'help': {
            bot.sendMessage(chatId, `📖 <b>Помощь</b>\n\nИспользуйте кнопки для управления ботом.`, { parse_mode: 'HTML' });
            break;
        }
        case 'skip_question': {
            // Очищаем таймер при пропуске вопроса
            clearQuestionTimer(userId);
            if (userCurrentQuestions[userId]) {
                delete userCurrentQuestions[userId];
            }
            if (!canAnswerMore(userId)) {
                bot.sendMessage(chatId, `❌ Вы уже ответили на 30 вопросов сегодня!`);
                return;
            }
            sendQuestion(chatId, userId);
            break;
        }
        case 'show_hint': {
            const question = userCurrentQuestions[userId];
            if (question && question.paragraphs_uids) {
                const paraUids = question.paragraphs_uids.value || [];
                if (paraUids.length > 0 && paragraphsDict[paraUids[0]]) {
                    const hint = paragraphsDict[paraUids[0]].text.substring(0, 500) + '...';
                    bot.sendMessage(chatId, `💡 <b>Подсказка:</b>\n\n${hint}`, { parse_mode: 'HTML' });
                } else {
                    bot.sendMessage(chatId, '❌ Подсказка недоступна для этого вопроса.');
                }
            }
            break;
        }
        case 'show_paragraphs': {
            showQuestionParagraphs(chatId, userId);
            break;
        }
        case 'next_paragraph': {
            showNextParagraph(chatId, userId);
            break;
        }
        case 'prev_paragraph': {
            showPrevParagraph(chatId, userId);
            break;
        }
        case 'set_difficulty_menu': {
            const userForDifficulty = users[userId];
            const currentDiff = userForDifficulty ? (userForDifficulty.difficulty || 'all') : 'all';
            
            const diffNames = {
                'all': '🌐 Все вопросы',
                'easy': '🟢 Легкие (1-hop, 0-hop)',
                'medium': '🟡 Средние (multi-constraint, reverse и др.)',
                'hard': '🔴 Сложные (multi-hop, count, ranking и др.)'
            };
            
            const text = `⚙️ <b>Настройка сложности вопросов</b>\n\n` +
                `Текущий уровень: <b>${diffNames[currentDiff]}</b>\n\n` +
                `Выберите уровень сложности:`;
            
            const keyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: (currentDiff === 'all' ? '✅ ' : '') + diffNames['all'], callback_data: 'set_difficulty_all' }],
                        [{ text: (currentDiff === 'easy' ? '✅ ' : '') + diffNames['easy'], callback_data: 'set_difficulty_easy' }],
                        [{ text: (currentDiff === 'medium' ? '✅ ' : '') + diffNames['medium'], callback_data: 'set_difficulty_medium' }],
                        [{ text: (currentDiff === 'hard' ? '✅ ' : '') + diffNames['hard'], callback_data: 'set_difficulty_hard' }],
                        [{ text: '🏠 Выйти в меню', callback_data: 'main_menu' }]
                    ]
                }
            };
            
            bot.sendMessage(chatId, text, { ...keyboard, parse_mode: 'HTML' });
            break;
        }
        case 'set_difficulty_all':
        case 'set_difficulty_easy':
        case 'set_difficulty_medium':
        case 'set_difficulty_hard': {
            const difficulty = data.replace('set_difficulty_', '');
            if (users[userId]) {
                users[userId].difficulty = difficulty;
                saveUsers();
                
                const difficultyNames = {
                    'all': '🌐 Все вопросы',
                    'easy': '🟢 Легкие',
                    'medium': '🟡 Средние',
                    'hard': '🔴 Сложные'
                };
                
                bot.sendMessage(chatId, `✅ Уровень сложности изменен на: <b>${difficultyNames[difficulty]}</b>\n\nТеперь вам будут предлагаться вопросы выбранного уровня сложности.`, { parse_mode: 'HTML' });
            }
            break;
        }
        case 'main_menu': {
            // Очищаем таймер при выходе в меню
            clearQuestionTimer(userId);
            if (userCurrentQuestions[userId]) {
                delete userCurrentQuestions[userId];
            }
            // Очищаем сохраненные вопросы и индексы параграфов
            if (userLastAnsweredQuestions[userId]) {
                delete userLastAnsweredQuestions[userId];
            }
            if (userParagraphIndices[userId]) {
                delete userParagraphIndices[userId];
            }
            const userForMenu = users[userId];
            const welcomeText = `👋 Привет, ${userForMenu ? (userForMenu.firstName || 'друг') : 'друг'}!

🎯 Я бот для викторины RuBQ 2.0!

📚 Я задаю вопросы из базы знаний, а ты отвечаешь.
📊 Ты можешь решить до 30 вопросов в день.

🎮 Используй команды:
/start - Начать
/question - Новый вопрос
/top - Топ игроков
/stats - Твоя статистика
/achievements - Достижения
/help - Помощь

Готов начать? Нажми кнопку ниже! 👇`;
            
            const keyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '🎯 Начать викторину', callback_data: 'new_question' }],
                        [{ text: '📊 Моя статистика', callback_data: 'my_stats' }, { text: '🏆 Топ игроков', callback_data: 'top_players' }],
                        [{ text: '🎖️ Достижения', callback_data: 'my_achievements' }, { text: '❓ Помощь', callback_data: 'help' }]
                    ]
                }
            };
            
            bot.sendMessage(chatId, welcomeText, keyboard);
            break;
        }
    }
});

// Обработка текстовых ответов
bot.on('message', (msg) => {
    const chatId = msg.chat.id;
    const userId = msg.from.id;
    const text = msg.text;
    
    // Пропускаем команды
    if (text && text.startsWith('/')) {
        return;
    }
    
    // ========== УЛУЧШЕНИЕ 15: Обработка упоминаний бота в группах ==========
    if (msg.chat.type !== 'private') {
        if (text && (text.includes('@' + bot.getMe().then(me => me.username)) || msg.entities)) {
            // Бот упомянут в группе
            registerUser(msg);
            if (!canAnswerMore(userId)) {
                bot.sendMessage(chatId, `❌ @${msg.from.username || msg.from.first_name}, вы уже ответили на 30 вопросов сегодня!`);
                return;
            }
            sendQuestion(chatId, userId);
            return;
        }
    }
    
    // Если есть активный вопрос
    if (userCurrentQuestions[userId] && text) {
        registerUser(msg);
        
        if (!canAnswerMore(userId)) {
            bot.sendMessage(chatId, `❌ Вы уже ответили на 30 вопросов сегодня!`);
            return;
        }
        
        const question = userCurrentQuestions[userId];
        
        // Очищаем таймер, так как пользователь ответил
        clearQuestionTimer(userId);
        
        const result = checkAnswer(question, text);
        
        incrementDailyCount(userId);
        const updateResult = updateUserStats(userId, result.isCorrect, chatId, question);
        const leveledUp = updateResult.leveledUp;
        const questionDifficulty = updateResult.difficulty;
        logAnswer(userId, question.uid, text, result.isCorrect, result.correctAnswer, chatId);
        
        // ========== УЛУЧШЕНИЕ 16: Проверка достижений ==========
        const newAchievements = checkAchievements(userId);
        
        // Определяем полученный опыт и рейтинг
        const difficultyExpMultipliers = {
            'easy': { correct: 5, incorrect: 1 },
            'medium': { correct: 10, incorrect: 2 },
            'hard': { correct: 20, incorrect: 4 }
        };
        const multipliers = difficultyExpMultipliers[questionDifficulty] || difficultyExpMultipliers['medium'];
        const expGained = result.isCorrect ? multipliers.correct : multipliers.incorrect;
        
        const difficultyRatingMultipliers = {
            'easy': 5,
            'medium': 10,
            'hard': 20
        };
        const ratingGained = result.isCorrect ? difficultyRatingMultipliers[questionDifficulty] || 10 : 0;
        
        const difficultyNames = {
            'easy': '🟢 Легкий',
            'medium': '🟡 Средний',
            'hard': '🔴 Сложный'
        };
        
        let responseText = '';
        if (result.isCorrect) {
            responseText = `✅ <b>Правильно!</b>\n\n🎉 Отличная работа!\n\n📊 Правильный ответ: <b>${result.correctAnswer}</b>`;
        } else {
            responseText = `❌ <b>Неправильно</b>\n\n😔 Попробуйте еще раз!\n\n📊 Правильный ответ: <b>${result.correctAnswer}</b>`;
        }
        
        // Показываем информацию о сложности и наградах
        responseText += `\n\n📊 <b>Сложность вопроса:</b> ${difficultyNames[questionDifficulty]}`;
        if (result.isCorrect) {
            responseText += `\n💎 Получено опыта: <b>+${expGained}</b>`;
            responseText += `\n🏆 Получено рейтинга: <b>+${ratingGained}</b>`;
        } else {
            responseText += `\n💎 Получено опыта: <b>+${expGained}</b> (за попытку)`;
        }
        
        // ========== УЛУЧШЕНИЕ 17: Уведомление о повышении уровня ==========
        if (leveledUp) {
            const newLevel = users[userId].level;
            const levelName = getLevelName(newLevel);
            if (newLevel >= MAX_LEVEL) {
                responseText += `\n\n🎊 <b>Поздравляем! Вы достигли максимального уровня!</b>\n${levelName}`;
            } else {
                responseText += `\n\n🎊 <b>Поздравляем! Вы достигли нового уровня!</b>\n${levelName}`;
            }
        }
        
        // ========== УЛУЧШЕНИЕ 18: Уведомление о достижениях ==========
        if (newAchievements.length > 0) {
            responseText += `\n\n🎖️ <b>Новое достижение!</b>\n`;
            newAchievements.forEach(ach => {
                const achData = ACHIEVEMENTS[ach];
                if (achData) {
                    responseText += `${achData.name} - ${achData.desc}\n`;
                }
            });
        }
        
        const stats = getUserStats(userId);
        const levelName = getLevelName(stats.level);
        responseText += `\n\n📈 Ваша статистика:\n`;
        responseText += `✅ Правильных: ${stats.correctAnswers}/${stats.totalQuestions} (${stats.accuracy}%)\n`;
        responseText += `🔥 Серия: ${stats.streak}\n`;
        if (stats.level < MAX_LEVEL) {
            responseText += `${levelName} (${stats.progress}% до следующего)\n`;
        } else {
            responseText += `${levelName}\n`;
        }
        responseText += `📅 Осталось сегодня: ${stats.remainingToday} вопросов`;
        
        // Сохраняем вопрос для возможности показать подробности
        userLastAnsweredQuestions[userId] = question;
        userParagraphIndices[userId] = 0; // Сбрасываем индекс параграфа
        
        // Проверяем, есть ли параграфы для этого вопроса
        const hasParagraphs = question.paragraphs_uids && 
                              question.paragraphs_uids.with_answer && 
                              question.paragraphs_uids.with_answer.length > 0;
        
        const keyboard = {
            reply_markup: {
                inline_keyboard: [
                    [{ text: '➡️ Следующий вопрос', callback_data: 'new_question' }],
                    [{ text: '📊 Моя статистика', callback_data: 'my_stats' }, { text: '🏆 Топ игроков', callback_data: 'top_players' }]
                ]
            }
        };
        
        // Добавляем кнопку "Подробнее о вопросе" если есть параграфы
        if (hasParagraphs) {
            keyboard.reply_markup.inline_keyboard.push([
                { text: '📖 Подробнее о вопросе', callback_data: 'show_paragraphs' }
            ]);
        }
        
        bot.sendMessage(chatId, responseText, { ...keyboard, parse_mode: 'HTML' });
        delete userCurrentQuestions[userId];
    }
});

// Функция очистки таймера для пользователя
function clearQuestionTimer(userId) {
    if (questionTimers[userId]) {
        if (questionTimers[userId].mainTimer) {
            clearTimeout(questionTimers[userId].mainTimer);
        }
        if (questionTimers[userId].warningTimer) {
            clearTimeout(questionTimers[userId].warningTimer);
        }
        delete questionTimers[userId];
    }
}

function sendQuestion(chatId, userId) {
    registerUser({ from: { id: userId, first_name: '', last_name: '', username: '' }, chat: { id: chatId, type: 'private' } });
    
    // Очищаем предыдущий таймер если есть
    clearQuestionTimer(userId);
    
    const question = getRandomQuestion(userId);
    if (!question) {
        bot.sendMessage(chatId, '❌ Ошибка: вопросы не загружены.');
        return;
    }
    
    userCurrentQuestions[userId] = question;
    users[userId].currentQuestionId = question.uid;
    
    let questionText = `❓ <b>Вопрос:</b>\n\n${question.question_text}\n\n💬 Напишите ваш ответ:\n\n⏱️ <b>У вас 25 секунд!</b>`;
    
    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '⏭️ Пропустить вопрос', callback_data: 'skip_question' }],
                [{ text: '🏠 Выйти в меню', callback_data: 'main_menu' }]
            ]
        }
    };
    
    bot.sendMessage(chatId, questionText, { ...keyboard, parse_mode: 'HTML' });
    
    // Запускаем предупреждение за 10 секунд до окончания
    questionTimers[userId] = {};
    questionTimers[userId].warningTimer = setTimeout(() => {
        if (userCurrentQuestions[userId]) {
            bot.sendMessage(chatId, '⚠️ <b>Осталось 10 секунд!</b> Успейте ответить!', { parse_mode: 'HTML' });
        }
    }, WARNING_TIME);
    
    // Запускаем основной таймер на 25 секунд
    questionTimers[userId].mainTimer = setTimeout(() => {
        if (userCurrentQuestions[userId]) {
            // Время истекло
            const expiredQuestion = userCurrentQuestions[userId];
            delete userCurrentQuestions[userId];
            clearQuestionTimer(userId);
            
            // Показываем правильный ответ
            let displayAnswer = expiredQuestion.answer_text || '';
            if (!displayAnswer && expiredQuestion.answers && expiredQuestion.answers.length > 0) {
                const firstAnswer = expiredQuestion.answers[0];
                if (firstAnswer.type === 'uri' && firstAnswer.label) {
                    displayAnswer = firstAnswer.label;
                } else if (firstAnswer.type === 'literal' && firstAnswer.value !== undefined) {
                    displayAnswer = String(firstAnswer.value);
                }
            }
            
            // Определяем сложность вопроса
            const questionDifficulty = getQuestionDifficulty(expiredQuestion);
            const difficultyNames = {
                'easy': '🟢 Легкий',
                'medium': '🟡 Средний',
                'hard': '🔴 Сложный'
            };
            
            let responseText = `⏱️ <b>Время истекло!</b>\n\n❌ Ответ не засчитан.\n\n📊 Правильный ответ: <b>${displayAnswer}</b>`;
            responseText += `\n\n📊 <b>Сложность вопроса:</b> ${difficultyNames[questionDifficulty]}`;
            responseText += `\n⏱️ Время истекло - опыт и рейтинг не начислены`;
            
            // Сохраняем вопрос для возможности показать подробности
            userLastAnsweredQuestions[userId] = expiredQuestion;
            userParagraphIndices[userId] = 0;
            
            // Сохраняем результат с учетом сложности (но без награды, так как время истекло)
            if (users[userId]) {
                users[userId].totalQuestions++;
                if (!results[userId]) {
                    results[userId] = [];
                }
                results[userId].push({
                    date: new Date().toISOString(),
                    isCorrect: false,
                    questionId: expiredQuestion.uid,
                    chatId,
                    difficulty: questionDifficulty,
                    timeout: true
                });
                saveResults();
                saveUsers();
            }
            
            // Проверяем, есть ли параграфы для этого вопроса
            const hasParagraphs = expiredQuestion.paragraphs_uids && 
                                  expiredQuestion.paragraphs_uids.with_answer && 
                                  expiredQuestion.paragraphs_uids.with_answer.length > 0;
            
            const keyboard = {
                reply_markup: {
                    inline_keyboard: [
                        [{ text: '➡️ Следующий вопрос', callback_data: 'new_question' }],
                        [{ text: '📊 Моя статистика', callback_data: 'my_stats' }, { text: '🏆 Топ игроков', callback_data: 'top_players' }]
                    ]
                }
            };
            
            // Добавляем кнопку "Подробнее о вопросе" если есть параграфы
            if (hasParagraphs) {
                keyboard.reply_markup.inline_keyboard.push([
                    { text: '📖 Подробнее о вопросе', callback_data: 'show_paragraphs' }
                ]);
            }
            
            bot.sendMessage(chatId, responseText, { ...keyboard, parse_mode: 'HTML' });
            
            // Логируем истечение времени
            logAnswer(userId, expiredQuestion.uid, 'TIMEOUT', false, displayAnswer, chatId);
        }
    }, QUESTION_TIME_LIMIT);
}

function showUserStats(chatId, userId) {
    const stats = getUserStats(userId);
    if (!stats) {
        bot.sendMessage(chatId, '❌ Пользователь не найден. Используйте /start для регистрации.');
        return;
    }
    
    const levelName = getLevelName(stats.level);
    let levelText = `${levelName}`;
    if (stats.level < MAX_LEVEL) {
        levelText += `\n📊 ${stats.progress}% до следующего уровня`;
        levelText += `\n💎 Опыт: ${stats.experience}/${stats.expForNextLevel}`;
    } else {
        levelText += `\n💎 Опыт: ${stats.experience}`;
    }
    
    const user = users[userId];
    const difficulty = user.difficulty || 'all';
    const difficultyNames = {
        'all': '🌐 Все',
        'easy': '🟢 Легкие',
        'medium': '🟡 Средние',
        'hard': '🔴 Сложные'
    };
    
    const statsText = `📊 <b>Ваша статистика</b>\n\n` +
        `👤 Имя: ${stats.name}\n` +
        `${levelText}\n` +
        `📝 Всего вопросов: ${stats.totalQuestions}\n` +
        `✅ Правильных: ${stats.correctAnswers}\n` +
        `📈 Точность: ${stats.accuracy}%\n` +
        `🔥 Текущая серия: ${stats.streak}\n` +
        `⭐ Лучшая серия: ${stats.bestStreak}\n` +
        `🏆 Рейтинг: ${stats.rating}\n` +
        `📅 Сегодня решено: ${stats.todayQuestions}/30\n` +
        `⏰ Осталось сегодня: ${stats.remainingToday} вопросов\n` +
        `📆 Дней подряд: ${stats.consecutiveDays}\n` +
        `🎖️ Достижений: ${stats.achievements.length}\n` +
        `⚙️ Сложность: ${difficultyNames[difficulty]}\n\n` +
        `💡 <b>Система наград:</b>\n` +
        `🟢 Легкие: +5 опыта, +5 рейтинга\n` +
        `🟡 Средние: +10 опыта, +10 рейтинга\n` +
        `🔴 Сложные: +20 опыта, +20 рейтинга`;
    
    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🎯 Новый вопрос', callback_data: 'new_question' }],
                [{ text: '🏆 Топ игроков', callback_data: 'top_players' }, { text: '🎖️ Достижения', callback_data: 'my_achievements' }],
                [{ text: '⚙️ Настроить сложность', callback_data: 'set_difficulty_menu' }],
                [{ text: '🏠 Выйти в меню', callback_data: 'main_menu' }]
            ]
        }
    };
    
    bot.sendMessage(chatId, statsText, { ...keyboard, parse_mode: 'HTML' });
}

// ========== УЛУЧШЕНИЕ 19: Расширенный топ с фильтрами ==========
function showTopPlayers(chatId, sortBy = 'rating') {
    const topUsers = getTopUsers(10, sortBy);
    
    if (topUsers.length === 0) {
        bot.sendMessage(chatId, '📊 Пока нет игроков в рейтинге.');
        return;
    }
    
    let topText = `🏆 <b>Топ игроков</b> (по рейтингу)\n\n`;
    
    topUsers.forEach((user, index) => {
        const accuracy = user.totalQuestions > 0 
            ? Math.round((user.correctAnswers / user.totalQuestions) * 100) 
            : 0;
        const medal = index === 0 ? '🥇' : index === 1 ? '🥈' : index === 2 ? '🥉' : `${index + 1}.`;
        const name = `${user.firstName} ${user.lastName}`.trim() || user.username || `User ${user.id}`;
        const rating = calculateRating(user);
        const levelName = getLevelName(user.level || 1);
        topText += `${medal} ${name}\n`;
        topText += `   ✅ ${user.correctAnswers}/${user.totalQuestions} (${accuracy}%) | 🔥 ${user.bestStreak} | ${levelName} | 🏆 ${rating}\n\n`;
    });
    
    const keyboard = {
        reply_markup: {
            inline_keyboard: [
                [{ text: '🎯 Новый вопрос', callback_data: 'new_question' }],
                [{ text: '📊 Моя статистика', callback_data: 'my_stats' }]
            ]
        }
    };
    
    bot.sendMessage(chatId, topText, { ...keyboard, parse_mode: 'HTML' });
}

// ========== УЛУЧШЕНИЕ 20: Автосохранение каждые 5 минут ==========
setInterval(() => {
    saveUsers();
    saveResults();
    saveLogs();
    saveDailyStats();
    saveAchievements();
    saveGroups();
    saveQuestionHistory();
    console.log('💾 Автосохранение данных выполнено');
}, 5 * 60 * 1000);

// Функции для показа параграфов
function showQuestionParagraphs(chatId, userId) {
    const question = userLastAnsweredQuestions[userId];
    
    if (!question || !question.paragraphs_uids) {
        bot.sendMessage(chatId, '❌ Информация о вопросе недоступна.');
        return;
    }
    
    const withAnswerUids = question.paragraphs_uids.with_answer || [];
    
    if (withAnswerUids.length === 0) {
        bot.sendMessage(chatId, '❌ Для этого вопроса нет дополнительной информации.');
        return;
    }
    
    // Сбрасываем индекс на первый параграф
    userParagraphIndices[userId] = 0;
    
    // Показываем первый параграф
    showParagraphByIndex(chatId, userId, withAnswerUids, 0);
}

function showParagraphByIndex(chatId, userId, paraUids, index) {
    if (index < 0 || index >= paraUids.length) {
        bot.sendMessage(chatId, '❌ Параграф не найден.');
        return;
    }
    
    const paraUid = paraUids[index];
    const paragraph = paragraphsDict[paraUid];
    
    if (!paragraph) {
        bot.sendMessage(chatId, '❌ Параграф не найден в базе данных.');
        return;
    }
    
    let paraText = paragraph.text;
    
    // Ограничиваем длину текста для Telegram (максимум 4000 символов)
    const MAX_LENGTH = 4000;
    if (paraText.length > MAX_LENGTH) {
        paraText = paraText.substring(0, MAX_LENGTH - 3) + '...';
    }
    
    const currentNum = index + 1;
    const totalNum = paraUids.length;
    
    let text = `📖 <b>Подробнее о вопросе</b>\n\n`;
    text += `<i>Параграф ${currentNum} из ${totalNum}</i>\n\n`;
    text += paraText;
    
    // Формируем клавиатуру с навигацией
    const keyboard = {
        reply_markup: {
            inline_keyboard: []
        }
    };
    
    // Кнопки навигации
    const navButtons = [];
    if (index > 0) {
        navButtons.push({ text: '⬅️ Назад', callback_data: 'prev_paragraph' });
    }
    if (index < paraUids.length - 1) {
        navButtons.push({ text: '➡️ Вперед', callback_data: 'next_paragraph' });
    }
    if (navButtons.length > 0) {
        keyboard.reply_markup.inline_keyboard.push(navButtons);
    }
    
    // Кнопка возврата
    keyboard.reply_markup.inline_keyboard.push([
        { text: '🏠 Выйти в меню', callback_data: 'main_menu' }
    ]);
    
    bot.sendMessage(chatId, text, { ...keyboard, parse_mode: 'HTML' });
}

function showNextParagraph(chatId, userId) {
    const question = userLastAnsweredQuestions[userId];
    
    if (!question || !question.paragraphs_uids) {
        bot.sendMessage(chatId, '❌ Информация о вопросе недоступна.');
        return;
    }
    
    const withAnswerUids = question.paragraphs_uids.with_answer || [];
    
    if (withAnswerUids.length === 0) {
        bot.sendMessage(chatId, '❌ Для этого вопроса нет дополнительной информации.');
        return;
    }
    
    let currentIndex = userParagraphIndices[userId] || 0;
    currentIndex++;
    
    if (currentIndex >= withAnswerUids.length) {
        bot.sendMessage(chatId, '✅ Это последний параграф.');
        return;
    }
    
    userParagraphIndices[userId] = currentIndex;
    showParagraphByIndex(chatId, userId, withAnswerUids, currentIndex);
}

function showPrevParagraph(chatId, userId) {
    const question = userLastAnsweredQuestions[userId];
    
    if (!question || !question.paragraphs_uids) {
        bot.sendMessage(chatId, '❌ Информация о вопросе недоступна.');
        return;
    }
    
    const withAnswerUids = question.paragraphs_uids.with_answer || [];
    
    if (withAnswerUids.length === 0) {
        bot.sendMessage(chatId, '❌ Для этого вопроса нет дополнительной информации.');
        return;
    }
    
    let currentIndex = userParagraphIndices[userId] || 0;
    currentIndex--;
    
    if (currentIndex < 0) {
        bot.sendMessage(chatId, '✅ Это первый параграф.');
        return;
    }
    
    userParagraphIndices[userId] = currentIndex;
    showParagraphByIndex(chatId, userId, withAnswerUids, currentIndex);
}

// Обработка ошибок
bot.on('polling_error', (error) => {
    console.error('Ошибка polling:', error);
});

console.log('✅ Бот готов к работе!');
