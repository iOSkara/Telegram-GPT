#!/usr/bin/env node
const { join } = require('path');
const { Telegraf } = require('telegraf');
const { Configuration, OpenAIApi } = require('openai');
const { SessionManager } = require('@puregram/session');
const fs = require('fs');
require('dotenv').config({
    path: join(__dirname, '.env')
});
const { OPENAI_API_KEY, TELEGRAM_BOT_TOKEN, NODE_ENV } = process.env;
const configuration = new Configuration({
    apiKey: OPENAI_API_KEY
});
const openai = new OpenAIApi(configuration);
const bot = new Telegraf(TELEGRAM_BOT_TOKEN);

if (NODE_ENV === 'dev') {
    bot.use(Telegraf.log());
}

const createDialogs = (ctx, next) => {
    if (!ctx.session?.dialogs) {
        ctx.session.dialogs = new Map();
    }

    return next();
};

const slicedContext = dialog => {
    const contextLength = dialog.reduce(
        (acc, { content }) => acc + content.length,
        0
    );

    if (contextLength <= 4096 - 1000) {
        return dialog;
    }

    dialog.shift();

    return slicedContext(dialog);
};

function logToFile(message) {
    const timestamp = new Date().toISOString();
    const logMessage = `${timestamp} - ${message}\n`;

    fs.appendFile('bot_logs.txt', logMessage, (error) => {
        if (error) {
            console.error('Error writing log:', error);
        }
    });
}

async function logMessagesMiddleware(ctx, next) {
    // Log incoming messages
    if (ctx.updateType === 'message') {
        const messageText = ctx.message.text;
        const sender = ctx.from.username || `${ctx.from.first_name} ${ctx.from.last_name}`;
        const incomingMessage = `Incoming message from ${sender}: ${messageText}`;
        logToFile(incomingMessage);
    }

    // Capture outgoing messages
    const originalReplyWithMarkdown = ctx.replyWithMarkdown.bind(ctx);
    ctx.replyWithMarkdown = async function (text, ...args) {
        const outgoingMessage = `Outgoing message: ${text}`;
        logToFile(outgoingMessage);
        return originalReplyWithMarkdown(text, ...args);
    };

    await next();
}

bot.use(new SessionManager().middleware);
bot.use(createDialogs);

// Register the custom logging middleware
bot.use(logMessagesMiddleware);

bot.start(async ctx => await ctx.sendMessage('Привіт, я - штучний інтелект створений OpenAI!🤖\nЯ завжди на сторожі, готовий допомогти вам порадами і рішеннями будь-яких питань. Мої можливості безмежні, тому не соромтеся звертатися до мене будь-коли.\nЯ радий бути частиною вашого життя і бажаю успіхів в усіх починаннях!\nЗапитай в мене щось😏'));

bot.command('reset', async ctx => {
    ctx.session.dialogs.set(ctx.chat.id, []);

    await ctx.sendMessage('Chat has been reset!');
});

bot.on('text', async ctx => {
    const chatId = ctx.chat.id;

    if (!ctx.session.dialogs.has(chatId)) {
        ctx.session.dialogs.set(chatId, []);
    }

    let dialog = ctx.session.dialogs.get(chatId);

    dialog.push({
        role: 'user',
        content: ctx.message.text
    });

    dialog = slicedContext(dialog);

    try {
        const response = await openai.createChatCompletion({
            model: 'gpt-3.5-turbo',
            messages: dialog,
            max_tokens: 1000
        });
        const { message } = response.data.choices[0];
        const { content } = message;

        dialog.push(message);

        await ctx.replyWithMarkdown(content);

        ctx.session.dialogs.delete(chatId);
        ctx.session.dialogs.set(chatId, dialog);
    } catch (error) {
        const openAIError = error.response?.data?.error?.message;

        if (openAIError) {
            return await ctx.sendMessage(openAIError);
        }

        await ctx.sendMessage(
            error?.response?.statusText ?? error.response.description
        );
    }
});

bot.catch(error => logToFile(error));

bot.launch();

