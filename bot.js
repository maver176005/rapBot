import { InferenceClient } from "@huggingface/inference";
import TelegramBot from "node-telegram-bot-api";
import axios from "axios";
import fs from "fs";
import schedule from "node-schedule";

// === Загрузка переменных окружения ===
import dotenv from "dotenv";
dotenv.config();

// === ТОКЕНЫ И ID КАНАЛА ===
const TELEGRAM_BOT_TOKEN = process.env.TELEGRAM_BOT_TOKEN;
const HUGGINGFACE_API_KEY = process.env.HUGGINGFACE_API_KEY;
const UNSPLASH_ACCESS_KEY = process.env.UNSPLASH_ACCESS_KEY;
const CHANNEL_ID = process.env.CHANNEL_ID 
const MODEL_NAME = process.env.MODEL_NAME || "deepseek-ai/DeepSeek-V3-0324";

// === Инициализация бота ===
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
    polling: true
});

// === Чтение треков и тем ===
let tracks = [];
let topics = [];

try {
    tracks = JSON.parse(fs.readFileSync("tracks.json"));
    topics = JSON.parse(fs.readFileSync("topics.json"));
} catch (e) {
    console.error("Ошибка чтения файлов tracks.json или topics.json");
    process.exit(1);
}

// === Хранение использованных тем ===
const USED_TOPICS_FILE = "used_topics.json";

function getUsedTopics() {
    if (!fs.existsSync(USED_TOPICS_FILE)) return [];
    return JSON.parse(fs.readFileSync(USED_TOPICS_FILE));
}

function saveUsedTopic(topic) {
    let used = getUsedTopics();
    used.push(topic);
    fs.writeFileSync(USED_TOPICS_FILE, JSON.stringify(used, null, 2));
}

function getRandomUnusedTopic() {
    const used = getUsedTopics();
    const available = topics.filter((t) => !used.includes(t));
    if (available.length === 0) {
        fs.writeFileSync(USED_TOPICS_FILE, "[]");
        return topics[Math.floor(Math.random() * topics.length)];
    }
    return available[Math.floor(Math.random() * available.length)];
}

// === Генерация текста про рэп ===
const hfClient = new InferenceClient( `${HUGGINGFACE_API_KEY}`);

async function generateRapPost(topic) {
    try {
        const response = await hfClient.chatCompletion({
            model: MODEL_NAME,
            messages: [
                {
                    role: "user",
                    content: `Напиши интересный пост про рэп на тему: "${topic}"`,
                },
            ],
            max_tokens: 300,
            temperature: 0.8,
        });

        return response.choices[0].message.content.trim();
    } catch (err) {
        console.error("❌ Ошибка генерации:", err.message);
        return "Произошла ошибка при генерации текста.";
    }
}

// === Выбор случайного трека ===
function getRandomTrack() {
    return tracks[Math.floor(Math.random() * tracks.length)];
}

// === Получение случайного изображения с Unsplash ===
async function getRandomImageUrl() {
    const UNSPLASH_URL = "https://api.unsplash.com/photos/random";
    const params = {
        query: "music hiphop rhythm beats",
        client_id: UNSPLASH_ACCESS_KEY,
        orientation: "landscape",
    };

    try {
        const response = await axios.get(UNSPLASH_URL, { params });
        return response.data.urls.regular;
    } catch (error) {
        console.error("🖼️ Не удалось загрузить изображение:", error.message);
        return "https://images.unsplash.com/photo-1519389950473-47ba0277781c?ixlib=rb-4.0.3&auto=format&w=600&q=60";
    }
}

// === Публикация в Telegram канале ===
async function postToChannel() {
    const topic = getRandomUnusedTopic();
    console.log(`🧠 Генерация поста на тему: "${topic}"`);

    const postText = await generateRapPost(topic);
    const track = getRandomTrack();
    const imageUrl = await getRandomImageUrl();

    console.log("📬 Отправка в канал...");

    try {
        await bot.sendPhoto(CHANNEL_ID, imageUrl);
        await bot.sendMessage(CHANNEL_ID, postText);
        await bot.sendMessage(
            CHANNEL_ID,
            `🎧 Слушай мой новый трек:\n${track.title}\n${track.link}`
        );
        saveUsedTopic(topic);
        console.log("✅ Пост успешно опубликован!");
    } catch (error) {
        console.error("❌ Ошибка отправки в Telegram:", error.message);
    }
}

// === Кнопки меню ===
const mainMenuOptions = {
    reply_markup: {
        inline_keyboard: [
            [{ text: "🎤 Совет по Flow", callback_data: "flow_advice" }],
            [{ text: "📝 Как писать тексты", callback_data: "writing_tips" }],
            [{ text: "💬 Идеи для рифм", callback_data: "rhyme_ideas" }],
            [{ text: "🎧 Топ треков", callback_data: "top_tracks" }],
        ],
    },
};

bot.onText(/\/menu/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, "Выбери, что хочешь узнать:", mainMenuOptions);
});

bot.onText(/\/start/, async (msg) => {
    const chatId = msg.chat.id;
    await bot.sendMessage(chatId, "👋 Привет! Я могу дать тебе советы по рэпу, генерировать тексты и публиковать посты в канал.");
});

bot.onText(/\/advice/, async (msg) => {
    const advice = await getFlowAdvice();
    await bot.sendMessage(msg.chat.id, advice);
});

bot.on("callback_query", async (query) => {
    const chatId = query.message.chat.id;
    const data = query.data;

    let response = "";

    switch (data) {
        case "flow_advice":
            response = await getFlowAdvice();
            break;
        case "writing_tips":
            response = await getWritingTips();
            break;
        case "rhyme_ideas":
            response = await getRhymeIdeas();
            break;
        case "top_tracks":
            response = `🎧 Вот топ треков:\n${tracks.map((t) => `- ${t.title} → ${t.link}`).join("\n")}`;
            break;
        default:
            response = "Неизвестная команда.";
    }

    await bot.sendMessage(chatId, response);
});

// === Генерация советов ===
async function getFlowAdvice() {
    return generateAIResponse("Дай совет начинающему рэперу по развитию уникального flow.");
}

async function getWritingTips() {
    return generateAIResponse("Как правильно начать писать тексты к песням? Советы для новичков.");
}

async function getRhymeIdeas() {
    return generateAIResponse("Придумай 5 строк с рифмой на слово 'ночь'.");
}

// === Генерация AI-ответа ===
async function generateAIResponse(prompt) {
    try {
        const response = await hfClient.chatCompletion({
            model: MODEL_NAME,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 150,
        });

        return response.choices[0].message.content;
    } catch (err) {
        console.error("❌ Ошибка генерации через HuggingFace:", err.message);
        return "Произошла ошибка при генерации текста.";
    }
}

// === Аналитика использования команд ===
function loadAnalytics() {
    if (!fs.existsSync("analytics.json")) {
        fs.writeFileSync("analytics.json", JSON.stringify({ users: [], commands_used: { advice: 0, lyrics: 0 } }));
    }
    return JSON.parse(fs.readFileSync("analytics.json"));
}

function saveAnalytics(data) {
    fs.writeFileSync("analytics.json", JSON.stringify(data, null, 2));
}

// === Команда /advice ===
bot.onText(/\/advice/, async (msg) => {
    const chatId = msg.chat.id;
    const analytics = loadAnalytics();

    if (!analytics.users.includes(chatId)) {
        analytics.users.push(chatId);
    }
    analytics.commands_used.advice += 1;
    saveAnalytics(analytics);

    const advice = await getFlowAdvice();
    await bot.sendMessage(chatId, advice);
});

// === Команда /lyrics ===
bot.onText(/\/lyrics (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const theme = match[1];
    const analytics = loadAnalytics();

    if (!analytics.users.includes(chatId)) {
        analytics.users.push(chatId);
    }
    analytics.commands_used.lyrics += 1;
    saveAnalytics(analytics);

    const lyrics = await generateLyrics(theme);
    await bot.sendMessage(chatId, `🎵 Вот строки по теме "${theme}":\n\n${lyrics}`);
});

// === Генерация текста под трек ===
async function generateLyrics(theme) {
    try {
        const response = await hfClient.chatCompletion({
            model: MODEL_NAME,
            messages: [{ role: "user", content: `Напиши несколько строчек рэпа на тему: ${theme}` }],
            max_tokens: 200,
        });

        return response.choices[0].message.content;
    } catch (err) {
        console.error("❌ Ошибка генерации текста:", err.message);
        return "Не удалось сгенерировать текст.";
    }
}

// === Запуск по расписанию (раз в день в 10:00) ===
console.log("⏰ Бот запущен и ожидает...");
// schedule.scheduleJob("0 10 * * *", () => {
//     console.log("🕒 Пришло время публиковать новый пост!");
//     postToChannel();
// });

// === Ручной запуск для тестирования ===
postToChannel();
