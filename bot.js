// === Импорт зависимостей ===
import { InferenceClient } from "npm:@huggingface/inference";
import TelegramBot from "https://esm.sh/node-telegram-bot-api@0.66.0";
import axios from "https://esm.sh/axios@1.6.7";

// === Переменные окружения через Deno.env.get() ===
const TELEGRAM_BOT_TOKEN = Deno.env.get("TELEGRAM_BOT_TOKEN");
const HUGGINGFACE_API_KEY = Deno.env.get("HUGGINGFACE_API_KEY");
const UNSPLASH_ACCESS_KEY = Deno.env.get("UNSPLASH_ACCESS_KEY");
const CHANNEL_ID = Deno.env.get("CHANNEL_ID");
const MODEL_NAME = Deno.env.get("MODEL_NAME") || "deepseek-ai/DeepSeek-V3-0324";

// === Подключение KV Storage для аналитики и данных ===
const kv = await Deno.openKv();

// === Инициализация бота ===
const bot = new TelegramBot(TELEGRAM_BOT_TOKEN, {
    polling: true,
});

// === Чтение треков и тем из KV или fallback к локальным файлам (для Deno CLI) ===
let tracks = [];
let topics = [];

try {
    const tracksJson = await kv.get(["tracks"]);
    const topicsJson = await kv.get(["topics"]);

    tracks = tracksJson.value || JSON.parse(Deno.readTextFileSync("tracks.json"));
    topics = topicsJson.value || JSON.parse(Deno.readTextFileSync("topics.json"));

    // Сохраняем в KV, чтобы не читать файлы каждый раз
    await kv.set(["tracks"], tracks);
    await kv.set(["topics"], topics);
} catch (e) {
    console.error("Ошибка чтения файлов tracks.json или topics.json", e.message);
    Deno.exit(1);
}

// === Хранение использованных тем через KV ===
async function getUsedTopics() {
    const entry = await kv.get(["used_topics"]);
    return entry.value || [];
}

async function saveUsedTopic(topic) {
    const used = await getUsedTopics();
    if (!used.includes(topic)) {
        used.push(topic);
        await kv.set(["used_topics"], used);
    }
}

async function getRandomUnusedTopic() {
    const used = await getUsedTopics();
    const available = topics.filter((t) => !used.includes(t));
    if (available.length === 0) {
        await kv.set(["used_topics"], []);
        return topics[Math.floor(Math.random() * topics.length)];
    }
    return available[Math.floor(Math.random() * available.length)];
}

// === Генерация текста про рэп ===
const hfClient = new InferenceClient(HUGGINGFACE_API_KEY);

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
    const topic = await getRandomUnusedTopic();
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
        await saveUsedTopic(topic);
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
    await bot.sendMessage(
        chatId,
        "👋 Привет! Я могу дать тебе советы по рэпу, генерировать тексты и публиковать посты в канал."
    );
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
    return await generateAIResponse("Дай совет начинающему рэперу по развитию уникального flow.");
}

async function getWritingTips() {
    return await generateAIResponse("Как правильно начать писать тексты к песням? Советы для новичков.");
}

async function getRhymeIdeas() {
    return await generateAIResponse("Придумай 5 строк с рифмой на слово 'ночь'.");
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
async function loadAnalytics() {
    const entry = await kv.get(["analytics"]);
    const data = entry.value || { users: [], commands_used: { advice: 0, lyrics: 0 } };
    return data;
}

async function saveAnalytics(data) {
    await kv.set(["analytics"], data);
}

// === Команда /advice ===
bot.onText(/\/advice/, async (msg) => {
    const chatId = msg.chat.id;
    const analytics = await loadAnalytics();

    if (!analytics.users.includes(chatId)) {
        analytics.users.push(chatId);
    }
    analytics.commands_used.advice += 1;
    await saveAnalytics(analytics);

    const advice = await getFlowAdvice();
    await bot.sendMessage(chatId, advice);
});

// === Команда /lyrics ===
bot.onText(/\/lyrics (.+)/, async (msg, match) => {
    const chatId = msg.chat.id;
    const theme = match[1];
    const analytics = await loadAnalytics();

    if (!analytics.users.includes(chatId)) {
        analytics.users.push(chatId);
    }
    analytics.commands_used.lyrics += 1;
    await saveAnalytics(analytics);

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

// Для Deno Deploy Cron Triggers:
// https://deno.com/deploy/docs/runtime-cron-jobs

// === Ручной запуск для тестирования ===
await postToChannel();