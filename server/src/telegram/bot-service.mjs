import { createHmac } from 'node:crypto';
import { convert } from 'html-to-text';
import { getTelegramAuthContext } from '../services/account-service.mjs';
import {
    createRandomEmailRegister,
    createEmailRegister,
    deleteEmailRegister,
    getEmailRegisterByAddress,
    getEmailRegisterById,
    listAvailableRegistrationDomains,
    listEmailRegisters
} from '../services/email-register-service.mjs';
import {
    assertRegisteredMailboxPermission,
    deleteEmailById,
    deleteEmailsByRecipient,
    getAuthorizedEmailsByIds,
    getInboxByAddress
} from '../services/email-service.mjs';
import { HttpError } from '../utils/http.mjs';
import { createTelegramClient } from './client.mjs';
import { getTelegramSettings } from '../services/telegram-settings-service.mjs';

const MAILBOX_PAGE_SIZE = 5;
const INBOX_PAGE_SIZE = 5;
const TELEGRAM_MESSAGE_LIMIT = 4096;

function getScopedAuth(auth) {
    return {
        ...auth,
        isAdmin: false
    };
}

function normalizeCommand(command) {
    return String(command || '')
        .trim()
        .split('@')[0]
        .toLowerCase();
}

function splitCommand(text) {
    const normalizedText = String(text || '').trim();
    const firstSpace = normalizedText.indexOf(' ');
    if (firstSpace === -1) {
        return {
            command: normalizedText,
            args: ''
        };
    }

    return {
        command: normalizedText.slice(0, firstSpace),
        args: normalizedText.slice(firstSpace + 1).trim()
    };
}

function formatDateTime(value) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) {
        return value || 'Unknown';
    }

    return date.toISOString().replace('T', ' ').replace(/\.\d{3}Z$/, ' UTC');
}

function makeInlineKeyboard(rows) {
    if (!rows.length) {
        return undefined;
    }

    return {
        inline_keyboard: rows
    };
}

function splitLongText(text, maxLength = TELEGRAM_MESSAGE_LIMIT) {
    const normalized = String(text || '').trim();
    if (!normalized) {
        return [''];
    }

    const chunks = [];
    let remaining = normalized;
    while (remaining.length > maxLength) {
        let splitIndex = remaining.lastIndexOf('\n', maxLength);
        if (splitIndex < Math.floor(maxLength / 2)) {
            splitIndex = remaining.lastIndexOf(' ', maxLength);
        }
        if (splitIndex < Math.floor(maxLength / 2)) {
            splitIndex = maxLength;
        }

        chunks.push(remaining.slice(0, splitIndex).trimEnd());
        remaining = remaining.slice(splitIndex).trimStart();
    }

    if (remaining) {
        chunks.push(remaining);
    }

    return chunks.length ? chunks : [''];
}

function buildCallbackData(config, action, ...parts) {
    const payload = [action, ...parts].join('|');
    const signature = createHmac('sha256', config.jwtSecret)
        .update(payload)
        .digest('base64url')
        .slice(0, 8);
    return `${payload}|${signature}`;
}

function parseCallbackData(config, value) {
    const segments = String(value || '').split('|');
    if (segments.length < 2) {
        throw new HttpError(400, 'Invalid callback payload');
    }

    const signature = segments.pop();
    const payload = segments.join('|');
    const expected = createHmac('sha256', config.jwtSecret)
        .update(payload)
        .digest('base64url')
        .slice(0, 8);

    if (signature !== expected) {
        throw new HttpError(400, 'Invalid callback signature');
    }

    return segments;
}

function helpText() {
    return [
        'Supported commands:',
        '/start',
        '/help',
        '/domains',
        '/mailboxes',
        '/newmail [domain]',
        '/register <email>',
        '/unregister <email>',
        '/inbox <email>',
        '/email <id>',
        '/delete <id>',
        '/clear <email>'
    ].join('\n');
}

export function getTelegramBotCommands() {
    return [
        { command: 'start', description: 'Show bot introduction and available commands' },
        { command: 'help', description: 'Show the supported command list' },
        { command: 'domains', description: 'List domains available for mailbox registration' },
        { command: 'mailboxes', description: 'List registered mailboxes for your account' },
        { command: 'newmail', description: 'Create a new random mailbox you are allowed to use' },
        { command: 'register', description: 'Register a mailbox you are allowed to use' },
        { command: 'unregister', description: 'Unregister one of your mailboxes' },
        { command: 'inbox', description: 'Open the inbox for a registered mailbox' },
        { command: 'email', description: 'Open a specific email by id' },
        { command: 'delete', description: 'Delete a specific email if you have write access' },
        { command: 'clear', description: 'Delete all emails in a mailbox if you have write access' }
    ];
}

function unauthorizedText(telegramUserId = '') {
    const normalizedTelegramUserId = String(telegramUserId || '').trim();
    if (normalizedTelegramUserId) {
        return [
            'This Telegram account is not linked to an active user.',
            `Your Telegram user id is: ${normalizedTelegramUserId}`,
            'Set this value as telegramId in the system first.'
        ].join('\n');
    }

    return 'This Telegram account is not linked to an active user. Set your telegramId in the system first.';
}

function privateChatText() {
    return 'Use this bot in a private chat only.';
}

function formatDomainsText(domains) {
    const lines = ['Available domains'];
    if (!domains.length) {
        lines.push('', 'No active inbound-enabled domain is available.');
        return lines.join('\n');
    }

    domains.forEach((domain, index) => {
        lines.push('', `${index + 1}. ${domain}`);
    });

    return lines.join('\n');
}

function getPlainEmailBody(email) {
    const text = String(email.text || '').trim();
    if (text) {
        return text;
    }

    const html = String(email.html || '').trim();
    if (!html) {
        return '(No content)';
    }

    const converted = convert(html, {
        wordwrap: false
    }).trim();

    return converted || '(No content)';
}

function formatMailboxesText(page, result) {
    const lines = ['Registered mailboxes'];
    if (!result.registrations.length) {
        lines.push('', 'No registered mailbox found.');
        return lines.join('\n');
    }

    const start = page * MAILBOX_PAGE_SIZE;
    result.registrations.forEach((registration, index) => {
        lines.push(
            '',
            `${start + index + 1}. ${registration.emailAddress}`,
            `Emails: ${registration.emailCount}`,
            `Latest: ${registration.latestReceivedAt ? formatDateTime(registration.latestReceivedAt) : 'No email yet'}`
        );
    });

    return lines.join('\n');
}

function formatInboxText(registration, page, result) {
    const lines = [`Inbox: ${registration.emailAddress}`];

    if (!result.emails.length) {
        lines.push('', 'No email found in this mailbox.');
        return lines.join('\n');
    }

    const start = page * INBOX_PAGE_SIZE;
    result.emails.forEach((email, index) => {
        lines.push(
            '',
            `${start + index + 1}. #${email.id} ${email.subject || '(No Subject)'}`,
            `From: ${email.from?.address || email.envelopeFrom || 'Unknown'}`,
            `Received: ${formatDateTime(email.receivedAt)}`
        );
    });

    return lines.join('\n');
}

async function sendText(client, chatId, text, options = {}) {
    return client.sendMessage(chatId, text, options);
}

async function editText(client, chatId, messageId, text, options = {}) {
    return client.editMessageText(chatId, messageId, text, options);
}

async function answerError(client, callbackQueryId, message) {
    await client.answerCallbackQuery(callbackQueryId, {
        text: message,
        show_alert: true
    });
}

async function resolveTelegramAuth(config, update) {
    const from = update?.message?.from || update?.callback_query?.from || null;
    if (!from?.id) {
        return null;
    }

    return getTelegramAuthContext(config, String(from.id));
}

async function renderMailboxesMessage(config, auth, page = 0) {
    const safePage = Math.max(0, Number.parseInt(String(page), 10) || 0);
    const result = await listEmailRegisters(config, getScopedAuth(auth), {}, {
        limit: MAILBOX_PAGE_SIZE,
        offset: safePage * MAILBOX_PAGE_SIZE
    });

    const buttons = [];
    for (const registration of result.registrations) {
        buttons.push([
            {
                text: `Inbox ${registration.emailAddress}`,
                callback_data: buildCallbackData(config, 'ib', registration.id, 0)
            },
            {
                text: 'Unregister',
                callback_data: buildCallbackData(config, 'uc', registration.id)
            }
        ]);
    }

    const navRow = [];
    if (safePage > 0) {
        navRow.push({
            text: 'Prev',
            callback_data: buildCallbackData(config, 'mb', safePage - 1)
        });
    }
    if (result.total > (safePage + 1) * MAILBOX_PAGE_SIZE) {
        navRow.push({
            text: 'Next',
            callback_data: buildCallbackData(config, 'mb', safePage + 1)
        });
    }
    if (navRow.length) {
        buttons.push(navRow);
    }

    return {
        text: formatMailboxesText(safePage, result),
        reply_markup: makeInlineKeyboard(buttons)
    };
}

async function getInboxPage(config, auth, registration, page = 0) {
    const safePage = Math.max(0, Number.parseInt(String(page), 10) || 0);
    let cursor = '';
    let result = null;

    for (let index = 0; index <= safePage; index += 1) {
        result = await getInboxByAddress(config, registration.emailAddress, {
            limit: INBOX_PAGE_SIZE,
            cursor
        });

        if (index === safePage || !result.hasMore || !result.nextCursor) {
            return {
                page: safePage,
                result
            };
        }

        cursor = result.nextCursor;
    }

    return {
        page: safePage,
        result: result || {
            count: 0,
            emails: [],
            hasMore: false,
            nextCursor: null
        }
    };
}

async function renderInboxMessage(config, auth, registrationId, page = 0) {
    const scopedAuth = getScopedAuth(auth);
    const registration = await getEmailRegisterById(config, scopedAuth, registrationId);
    await assertRegisteredMailboxPermission(config, scopedAuth, registration.emailAddress, 'view');

    const { page: safePage, result } = await getInboxPage(config, scopedAuth, registration, page);
    const emailIds = result.emails.map(email => email.id);
    const writeAccess = emailIds.length
        ? await getAuthorizedEmailsByIds(config, scopedAuth, emailIds, {
            permission: 'write'
        })
        : { emails: [] };
    const writableIds = new Set(writeAccess.emails.map(email => email.id));

    const buttons = [];
    for (const email of result.emails) {
        const row = [
            {
                text: `Open #${email.id}`,
                callback_data: buildCallbackData(config, 'em', email.id)
            }
        ];

        if (writableIds.has(email.id)) {
            row.push({
                text: 'Delete',
                callback_data: buildCallbackData(config, 'dc', email.id)
            });
        }

        buttons.push(row);
    }

    const navRow = [];
    if (safePage > 0) {
        navRow.push({
            text: 'Prev',
            callback_data: buildCallbackData(config, 'ib', registration.id, safePage - 1)
        });
    }
    if (result.hasMore) {
        navRow.push({
            text: 'Next',
            callback_data: buildCallbackData(config, 'ib', registration.id, safePage + 1)
        });
    }
    if (navRow.length) {
        buttons.push(navRow);
    }

    buttons.push([
        {
            text: 'Clear mailbox',
            callback_data: buildCallbackData(config, 'cc', registration.id)
        }
    ]);

    return {
        text: formatInboxText(registration, safePage, result),
        reply_markup: makeInlineKeyboard(buttons)
    };
}

async function sendEmailDetail(config, auth, chatId, emailId, options = {}) {
    const scopedAuth = getScopedAuth(auth);
    const lookup = await getAuthorizedEmailsByIds(config, scopedAuth, [emailId], {
        includeRawMime: false
    });

    if (lookup.missingIds.length) {
        throw new HttpError(404, 'Email not found');
    }

    if (lookup.deniedIds.length) {
        throw new HttpError(403, 'Email is not available for this user');
    }

    const email = lookup.emails[0];
    const writeLookup = await getAuthorizedEmailsByIds(config, scopedAuth, [emailId], {
        permission: 'write'
    });
    const canDelete = writeLookup.emails.length === 1;
    const body = getPlainEmailBody(email);
    const header = [
        `Email #${email.id}`,
        `To: ${email.to}`,
        `From: ${email.from?.address || email.envelopeFrom || 'Unknown'}`,
        `Subject: ${email.subject || '(No Subject)'}`,
        `Received: ${formatDateTime(email.receivedAt)}`,
        '',
        body
    ].join('\n');
    const chunks = splitLongText(header);
    const client = createTelegramClient(config);

    for (let index = 0; index < chunks.length; index += 1) {
        const isLast = index === chunks.length - 1;
        await client.sendMessage(chatId, chunks[index], {
            reply_markup: isLast && canDelete
                ? makeInlineKeyboard([
                    [{
                        text: 'Delete email',
                        callback_data: buildCallbackData(config, 'dc', email.id)
                    }]
                ])
                : undefined
        });
    }

    if (options.callbackQueryId) {
        await client.answerCallbackQuery(options.callbackQueryId, {
            text: `Opened email #${email.id}`
        });
    }
}

async function confirmDeleteEmail(config, auth, emailId) {
    const scopedAuth = getScopedAuth(auth);
    const lookup = await getAuthorizedEmailsByIds(config, scopedAuth, [emailId], {
        permission: 'write'
    });

    if (lookup.missingIds.length) {
        throw new HttpError(404, 'Email not found');
    }

    if (lookup.deniedIds.length) {
        throw new HttpError(403, 'Write permission is required');
    }

    return {
        text: `Delete email #${emailId}?`,
        reply_markup: makeInlineKeyboard([
            [{
                text: 'Confirm delete',
                callback_data: buildCallbackData(config, 'dd', emailId)
            }]
        ])
    };
}

async function confirmClearMailbox(config, auth, registrationId) {
    const scopedAuth = getScopedAuth(auth);
    const registration = await getEmailRegisterById(config, scopedAuth, registrationId);
    await assertRegisteredMailboxPermission(config, scopedAuth, registration.emailAddress, 'write');
    return {
        text: `Delete all emails in ${registration.emailAddress}?`,
        reply_markup: makeInlineKeyboard([
            [{
                text: 'Confirm clear',
                callback_data: buildCallbackData(config, 'cd', registration.id)
            }]
        ])
    };
}

async function confirmUnregister(config, auth, registrationId) {
    const scopedAuth = getScopedAuth(auth);
    const registration = await getEmailRegisterById(config, scopedAuth, registrationId);
    return {
        text: `Unregister mailbox ${registration.emailAddress}?`,
        reply_markup: makeInlineKeyboard([
            [{
                text: 'Confirm unregister',
                callback_data: buildCallbackData(config, 'ur', registration.id)
            }]
        ])
    };
}

async function handleMessageUpdate(config, update) {
    const message = update.message;
    if (!message?.chat?.id) {
        return { handled: false };
    }

    const client = createTelegramClient(config);
    if (message.chat.type !== 'private') {
        await sendText(client, message.chat.id, privateChatText());
        return { handled: true };
    }

    const auth = await resolveTelegramAuth(config, update);
    if (!auth) {
        await sendText(client, message.chat.id, unauthorizedText(message.from?.id));
        return { handled: true };
    }

    const text = String(message.text || '').trim();
    if (!text.startsWith('/')) {
        await sendText(client, message.chat.id, 'Use /help to see supported commands.');
        return { handled: true };
    }

    const parsed = splitCommand(text);
    const command = normalizeCommand(parsed.command);
    const args = parsed.args;

    switch (command) {
        case '/start':
            await sendText(client, message.chat.id, [
                `Hello ${auth.displayName || auth.username}.`,
                '',
                helpText()
            ].join('\n'));
            return { handled: true };
        case '/help':
            await sendText(client, message.chat.id, helpText());
            return { handled: true };
        case '/domains': {
            const domains = await listAvailableRegistrationDomains(config, auth);
            await sendText(client, message.chat.id, formatDomainsText(domains));
            return { handled: true };
        }
        case '/mailboxes': {
            const rendered = await renderMailboxesMessage(config, auth, 0);
            await sendText(client, message.chat.id, rendered.text, {
                reply_markup: rendered.reply_markup
            });
            return { handled: true };
        }
        case '/newmail': {
            const registration = await createRandomEmailRegister(config, auth, {
                domain: args || undefined
            });
            await sendText(client, message.chat.id, `Registered ${registration.emailAddress}.`, {
                reply_markup: makeInlineKeyboard([
                    [{
                        text: 'Open inbox',
                        callback_data: buildCallbackData(config, 'ib', registration.id, 0)
                    }]
                ])
            });
            return { handled: true };
        }
        case '/register': {
            if (!args) {
                throw new HttpError(400, 'Usage: /register <email>');
            }

            const registration = await createEmailRegister(config, auth, {
                emailAddress: args
            });
            await sendText(client, message.chat.id, `Registered ${registration.emailAddress}.`, {
                reply_markup: makeInlineKeyboard([
                    [{
                        text: 'Open inbox',
                        callback_data: buildCallbackData(config, 'ib', registration.id, 0)
                    }]
                ])
            });
            return { handled: true };
        }
        case '/unregister': {
            if (!args) {
                throw new HttpError(400, 'Usage: /unregister <email>');
            }

            const registration = await getEmailRegisterByAddress(config, getScopedAuth(auth), args);
            const rendered = await confirmUnregister(config, auth, registration.id);
            await sendText(client, message.chat.id, rendered.text, {
                reply_markup: rendered.reply_markup
            });
            return { handled: true };
        }
        case '/inbox': {
            if (!args) {
                throw new HttpError(400, 'Usage: /inbox <email>');
            }

            const registration = await getEmailRegisterByAddress(config, getScopedAuth(auth), args);
            const rendered = await renderInboxMessage(config, auth, registration.id, 0);
            await sendText(client, message.chat.id, rendered.text, {
                reply_markup: rendered.reply_markup
            });
            return { handled: true };
        }
        case '/email': {
            if (!args) {
                throw new HttpError(400, 'Usage: /email <id>');
            }

            await sendEmailDetail(config, auth, message.chat.id, args);
            return { handled: true };
        }
        case '/delete': {
            if (!args) {
                throw new HttpError(400, 'Usage: /delete <id>');
            }

            const rendered = await confirmDeleteEmail(config, auth, args);
            await sendText(client, message.chat.id, rendered.text, {
                reply_markup: rendered.reply_markup
            });
            return { handled: true };
        }
        case '/clear': {
            if (!args) {
                throw new HttpError(400, 'Usage: /clear <email>');
            }

            const registration = await getEmailRegisterByAddress(config, getScopedAuth(auth), args);
            const rendered = await confirmClearMailbox(config, auth, registration.id);
            await sendText(client, message.chat.id, rendered.text, {
                reply_markup: rendered.reply_markup
            });
            return { handled: true };
        }
        default:
            await sendText(client, message.chat.id, 'Unknown command. Use /help.');
            return { handled: true };
    }
}

async function handleCallbackUpdate(config, update) {
    const callbackQuery = update.callback_query;
    if (!callbackQuery?.id || !callbackQuery?.message?.chat?.id || !callbackQuery?.message?.message_id) {
        return { handled: false };
    }

    const client = createTelegramClient(config);
    if (callbackQuery.message.chat.type !== 'private') {
        await answerError(client, callbackQuery.id, privateChatText());
        return { handled: true };
    }

    const auth = await resolveTelegramAuth(config, update);
    if (!auth) {
        await answerError(client, callbackQuery.id, unauthorizedText(callbackQuery.from?.id));
        return { handled: true };
    }

    try {
        const [action, ...parts] = parseCallbackData(config, callbackQuery.data);
        switch (action) {
            case 'mb': {
                const rendered = await renderMailboxesMessage(config, auth, parts[0]);
                await editText(
                    client,
                    callbackQuery.message.chat.id,
                    callbackQuery.message.message_id,
                    rendered.text,
                    {
                        reply_markup: rendered.reply_markup
                    }
                );
                await client.answerCallbackQuery(callbackQuery.id);
                return { handled: true };
            }
            case 'ib': {
                const rendered = await renderInboxMessage(config, auth, parts[0], parts[1]);
                await editText(
                    client,
                    callbackQuery.message.chat.id,
                    callbackQuery.message.message_id,
                    rendered.text,
                    {
                        reply_markup: rendered.reply_markup
                    }
                );
                await client.answerCallbackQuery(callbackQuery.id);
                return { handled: true };
            }
            case 'em':
                await sendEmailDetail(config, auth, callbackQuery.message.chat.id, parts[0], {
                    callbackQueryId: callbackQuery.id
                });
                return { handled: true };
            case 'dc': {
                const rendered = await confirmDeleteEmail(config, auth, parts[0]);
                await editText(
                    client,
                    callbackQuery.message.chat.id,
                    callbackQuery.message.message_id,
                    rendered.text,
                    {
                        reply_markup: rendered.reply_markup
                    }
                );
                await client.answerCallbackQuery(callbackQuery.id);
                return { handled: true };
            }
            case 'dd': {
                const scopedAuth = getScopedAuth(auth);
                const lookup = await getAuthorizedEmailsByIds(config, scopedAuth, [parts[0]], {
                    permission: 'write'
                });
                if (lookup.missingIds.length) {
                    throw new HttpError(404, 'Email not found');
                }
                if (lookup.deniedIds.length) {
                    throw new HttpError(403, 'Write permission is required');
                }

                await deleteEmailById(config, parts[0]);
                await editText(
                    client,
                    callbackQuery.message.chat.id,
                    callbackQuery.message.message_id,
                    `Deleted email #${parts[0]}.`
                );
                await client.answerCallbackQuery(callbackQuery.id, {
                    text: 'Email deleted'
                });
                return { handled: true };
            }
            case 'cc': {
                const rendered = await confirmClearMailbox(config, auth, parts[0]);
                await editText(
                    client,
                    callbackQuery.message.chat.id,
                    callbackQuery.message.message_id,
                    rendered.text,
                    {
                        reply_markup: rendered.reply_markup
                    }
                );
                await client.answerCallbackQuery(callbackQuery.id);
                return { handled: true };
            }
            case 'cd': {
                const scopedAuth = getScopedAuth(auth);
                const registration = await getEmailRegisterById(config, scopedAuth, parts[0]);
                await assertRegisteredMailboxPermission(config, scopedAuth, registration.emailAddress, 'write');
                await deleteEmailsByRecipient(config, registration.emailAddress);
                await editText(
                    client,
                    callbackQuery.message.chat.id,
                    callbackQuery.message.message_id,
                    `Deleted all emails in ${registration.emailAddress}.`
                );
                await client.answerCallbackQuery(callbackQuery.id, {
                    text: 'Mailbox cleared'
                });
                return { handled: true };
            }
            case 'uc': {
                const rendered = await confirmUnregister(config, auth, parts[0]);
                await editText(
                    client,
                    callbackQuery.message.chat.id,
                    callbackQuery.message.message_id,
                    rendered.text,
                    {
                        reply_markup: rendered.reply_markup
                    }
                );
                await client.answerCallbackQuery(callbackQuery.id);
                return { handled: true };
            }
            case 'ur': {
                const scopedAuth = getScopedAuth(auth);
                const registration = await getEmailRegisterById(config, scopedAuth, parts[0]);
                await deleteEmailRegister(config, scopedAuth, registration.id);
                await editText(
                    client,
                    callbackQuery.message.chat.id,
                    callbackQuery.message.message_id,
                    `Unregistered ${registration.emailAddress}.`
                );
                await client.answerCallbackQuery(callbackQuery.id, {
                    text: 'Mailbox unregistered'
                });
                return { handled: true };
            }
            default:
                throw new HttpError(400, 'Unsupported callback action');
        }
    } catch (error) {
        if (error instanceof HttpError) {
            await answerError(client, callbackQuery.id, error.message);
            return { handled: true, error: error.message };
        }

        throw error;
    }
}

export async function handleTelegramUpdate(config, update) {
    const settings = await getTelegramSettings(config);
    if (!settings.enabled || !settings.botToken || !settings.webhookSecret) {
        return { handled: false, reason: 'disabled' };
    }

    try {
        if (update?.message) {
            return await handleMessageUpdate(config, update);
        }

        if (update?.callback_query) {
            return await handleCallbackUpdate(config, update);
        }
    } catch (error) {
        if (error instanceof HttpError) {
            const chatId = update?.message?.chat?.id;
            if (chatId) {
                const client = createTelegramClient(config);
                await client.sendMessage(chatId, error.message);
                return { handled: true, error: error.message };
            }

            const callbackId = update?.callback_query?.id;
            if (callbackId) {
                const client = createTelegramClient(config);
                await answerError(client, callbackId, error.message);
                return { handled: true, error: error.message };
            }
        }

        throw error;
    }

    return { handled: false, reason: 'ignored' };
}

export async function registerTelegramWebhook(config) {
    const settings = await getTelegramSettings(config);
    if (!settings.enabled || !settings.botToken || !settings.publicBaseUrl || !settings.webhookSecret) {
        return { enabled: false };
    }

    const client = createTelegramClient(config);
    const url = `${settings.publicBaseUrl}/v1/telegram/webhook`;
    await client.setWebhook(url, {
        secret_token: settings.webhookSecret,
        allowed_updates: ['message', 'callback_query']
    });

    return {
        enabled: true,
        url
    };
}

export async function registerTelegramCommands(config) {
    const settings = await getTelegramSettings(config);
    if (!settings.enabled || !settings.botToken) {
        throw new HttpError(400, 'Telegram bot is not configured or enabled');
    }

    const client = createTelegramClient(config);
    const commands = getTelegramBotCommands();
    await client.setMyCommands(commands);
    return {
        success: true,
        count: commands.length,
        commands
    };
}
