function buildTelegramApiUrl(config, settings, method) {
    return `${config.telegramApiBaseUrl}/bot${settings.botToken}/${method}`;
}

async function callTelegram(config, settings, method, payload = {}) {
    const response = await fetch(buildTelegramApiUrl(config, settings, method), {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(payload)
    });

    let body = null;
    try {
        body = await response.json();
    } catch {
        body = null;
    }

    if (!response.ok || !body?.ok) {
        const description = body?.description || `Telegram API ${method} failed with ${response.status}`;
        const error = new Error(description);
        error.status = response.status;
        error.telegramBody = body;
        throw error;
    }

    return body.result;
}

export function createTelegramClient(config) {
    return createTelegramClientWithSettings(config, config.telegramSettings || null);
}

export function createTelegramClientWithSettings(config, settings) {
    if (!settings?.botToken) {
        throw new Error('Telegram bot token is not configured');
    }

    return {
        async sendMessage(chatId, text, options = {}) {
            return callTelegram(config, settings, 'sendMessage', {
                chat_id: chatId,
                text,
                disable_web_page_preview: true,
                ...options
            });
        },
        async editMessageText(chatId, messageId, text, options = {}) {
            try {
                return await callTelegram(config, settings, 'editMessageText', {
                    chat_id: chatId,
                    message_id: messageId,
                    text,
                    disable_web_page_preview: true,
                    ...options
                });
            } catch (error) {
                if (String(error?.message || '').toLowerCase().includes('message is not modified')) {
                    return null;
                }

                throw error;
            }
        },
        async answerCallbackQuery(callbackQueryId, options = {}) {
            return callTelegram(config, settings, 'answerCallbackQuery', {
                callback_query_id: callbackQueryId,
                ...options
            });
        },
        async setWebhook(url, options = {}) {
            return callTelegram(config, settings, 'setWebhook', {
                url,
                ...options
            });
        },
        async setMyCommands(commands, options = {}) {
            return callTelegram(config, settings, 'setMyCommands', {
                commands,
                ...options
            });
        }
    };
}
