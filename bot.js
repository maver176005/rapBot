// === Импорт зависимостей ==
import { Bot } from "https://deno.land/x/grammy@v1.36.3/mod.ts";
import { InferenceClient } from "npm:@huggingface/inference";

// === Переменные окружения ===
// === Импорт dotenv только для локального использования ===
let env;

if (typeof Deno !== "undefined") {
    env = {
        TELEGRAM_BOT_TOKEN: Deno.env.get("TELEGRAM_BOT_TOKEN"),
        HUGGINGFACE_API_KEY: Deno.env.get("HUGGINGFACE_API_KEY"),
        UNSPLASH_ACCESS_KEY: Deno.env.get("UNSPLASH_ACCESS_KEY"),
        CHANNEL_ID: Deno.env.get("CHANNEL_ID"),
        MODEL_NAME: Deno.env.get("MODEL_NAME") || "deepseek-ai/DeepSeek-V3-0324"
    };
} else {
    // Для Node.js (не используется в данном случае)
    const dotenv = require("dotenv");
    dotenv.config();
    env = process.env;
}

const { TELEGRAM_BOT_TOKEN, HUGGINGFACE_API_KEY, UNSPLASH_ACCESS_KEY, CHANNEL_ID, MODEL_NAME } = env;

if (!TELEGRAM_BOT_TOKEN) {
    throw new Error("Не указан TELEGRAM_BOT_TOKEN в .env или в окружении");
}

// === Инициализация бота через Grammy ===
const bot = new Bot(TELEGRAM_BOT_TOKEN);

// === Подключение KV Storage для хранения данных ===
const kv = await Deno.openKv();

// === Чтение треков и тем из KV или локальных файлов ===
let tracks = [];
let topics = [];

try {
    const tracksEntry = await kv.get(["tracks"]);
    const topicsEntry = await kv.get(["topics"]);

    tracks = tracksEntry.value || JSON.parse(await Deno.readTextFile("tracks.json"));
    topics = topicsEntry.value || JSON.parse(await Deno.readTextFile("topics.json"));

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

// === Получение случайного изображения с Unsplash ===
async function getRandomImageUrl() {
    const UNSPLASH_URL = "https://api.unsplash.com/photos/random";
    const params = new URLSearchParams({
        query: "music hiphop rhythm beats",
        orientation: "landscape"
    });

    try {
        const response = await fetch(`${UNSPLASH_URL}?${params}`, {
            headers: {
                Authorization: `Client-ID ${UNSPLASH_ACCESS_KEY}`,
            },
            method: "GET"
        });

        if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);

        const data = await response.json();
        return data.urls.regular;
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
    const track = tracks[Math.floor(Math.random() * tracks.length)];
    const imageUrl = await getRandomImageUrl();

    console.log("📬 Отправка в канал...");

    try {
        await bot.api.sendPhoto(CHANNEL_ID, imageUrl);
        await bot.api.sendMessage(CHANNEL_ID, postText);
        await bot.api.sendMessage(
            CHANNEL_ID,
            `🎧 Слушай мой новый трек:\n${track.title}\n${track.link}`
        );
        await saveUsedTopic(topic);
        console.log("✅ Пост успешно опубликован!");
    } catch (error) {
        console.error("❌ Ошибка отправки в Telegram:", error.message);
    }
}

// === Аналитика использования команд через KV ===
async function loadAnalytics() {
    const entry = await kv.get(["analytics"]);
    const data = entry.value || { users: [], commands_used: { advice: 0, lyrics: 0 } };
    return data;
}

async function saveAnalytics(data) {
    await kv.set(["analytics"], data);
}

// === Генерация AI-ответа ===
async function generateAIResponse(prompt) {
    try {
        const response = await hfClient.chatCompletion({
            model: MODEL_NAME,
            messages: [{ role: "user", content: prompt }],
            max_tokens: 200,
            temperature: 0.8,
            top_p: 0.9,
            repetition_penalty: 1.2
        });

        return response.choices[0].message.content;
    } catch (err) {
        console.error("❌ Ошибка генерации через HuggingFace:", err.message);
        return "Произошла ошибка при генерации текста.";
    }
}

// === Команды бота ===
bot.command("start", async (ctx) => {
    await ctx.reply("👋 Привет! Я могу дать тебе советы по рэпу, генерировать тексты и публиковать посты в канал.");
});

bot.command("menu", async (ctx) => {
    await ctx.reply("Выбери, что хочешь узнать:\n\n/modelexplain — объяснение модели\n/advice — получить совет\n/lyrics любовь — написать строки");
});

bot.command("advice", async (ctx) => {
    const analytics = await loadAnalytics();
    const chatId = ctx.chat.id;

    if (!analytics.users.includes(chatId)) {
        analytics.users.push(chatId);
    }

    analytics.commands_used.advice += 1;
    await saveAnalytics(analytics);

    const advice = await getFlowAdvice();
    await ctx.reply(advice);
});

bot.command("lyrics", async (ctx) => {
    const analytics = await loadAnalytics();
    const chatId = ctx.chat.id;
    const theme = ctx.match || "рэп";

    if (!analytics.users.includes(chatId)) {
        analytics.users.push(chatId);
    }

    analytics.commands_used.lyrics += 1;
    await saveAnalytics(analytics);

    const lyrics = await generateLyrics(theme);
    await ctx.reply(`🎵 Вот строки по теме "${theme}":\n\n${lyrics}`);
});

// === Генерация текста ===
async function getFlowAdvice() {
    return await generateAIResponse("Дай совет начинающему рэперу по развитию уникального flow.");
}

async function generateLyrics(theme) {
    try {
        const response = await hfClient.chatCompletion({
            model: MODEL_NAME,
            messages: [
                {
                    role: "user",
                    content: `Напиши 5 оригинальных строк рэпа на тему "${theme}". Сделай их разными каждый раз.`
                }
            ],
            max_tokens: 200,
            temperature: 0.85,
            repetition_penalty: 1.2
        });

        return response.choices[0].message.content;
    } catch (err) {
        console.error("❌ Ошибка генерации текста:", err.message);
        return "Не удалось сгенерировать текст.";
    }
}

// === Запуск бота ===
if (import.meta.main) {
    // Только если запущен как основной файл
    await bot.start();
    console.log("⏰ Бот запущен и ожидает...");

    // Подписываемся на обновления
    bot.on("message", async (ctx) => {
        console.log(`📩 Сообщение от ${ctx.from?.username}: ${ctx.message.text}`);
    });
}