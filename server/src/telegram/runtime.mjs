import { getTelegramOutboxStats, processTelegramOutbox, recoverTelegramOutbox } from './notifications.mjs';
import { registerTelegramWebhook } from './bot-service.mjs';
import { getPublicTelegramSettings, getTelegramSettings, loadTelegramSettings } from '../services/telegram-settings-service.mjs';

const runtimeState = {
    enabled: false,
    startedAt: null,
    webhookUrl: '',
    lastWebhookRegisteredAt: null,
    workerActive: false,
    processing: false,
    lastPollAt: null,
    lastDeliveryAt: null,
    lastError: '',
    lastResult: null,
    timer: null
};

function resetRuntimeState(enabled = false) {
    runtimeState.enabled = enabled;
    runtimeState.startedAt = null;
    runtimeState.webhookUrl = '';
    runtimeState.lastWebhookRegisteredAt = null;
    runtimeState.workerActive = false;
    runtimeState.processing = false;
    runtimeState.lastPollAt = null;
    runtimeState.lastDeliveryAt = null;
    runtimeState.lastError = '';
    runtimeState.lastResult = null;
}

async function runOutboxTick(config) {
    if (!runtimeState.enabled || runtimeState.processing) {
        return runtimeState.lastResult;
    }

    runtimeState.processing = true;
    runtimeState.lastPollAt = new Date().toISOString();
    try {
        const result = await processTelegramOutbox(config, {
            limit: config.telegramOutboxBatchSize
        });
        runtimeState.lastResult = result;
        if (result.sent > 0) {
            runtimeState.lastDeliveryAt = new Date().toISOString();
        }
        runtimeState.lastError = '';
        return result;
    } catch (error) {
        runtimeState.lastError = String(error?.message || error || 'Telegram runtime error');
        console.error('Telegram runtime tick failed:', error);
        throw error;
    } finally {
        runtimeState.processing = false;
    }
}

export async function startTelegramRuntime(config) {
    const settings = await loadTelegramSettings(config);
    if (!settings.enabled || !settings.botToken || !settings.publicBaseUrl || !settings.webhookSecret) {
        resetRuntimeState(false);
        return { enabled: false };
    }

    const webhook = await registerTelegramWebhook(config);
    const recovered = await recoverTelegramOutbox(config);
    resetRuntimeState(true);
    runtimeState.startedAt = new Date().toISOString();
    runtimeState.webhookUrl = webhook.url;
    runtimeState.lastWebhookRegisteredAt = runtimeState.startedAt;
    runtimeState.workerActive = true;
    runtimeState.lastError = '';
    runtimeState.lastResult = null;
    if (recovered.recovered > 0) {
        runtimeState.lastError = `Recovered ${recovered.recovered} interrupted Telegram outbox entries`;
    }

    if (runtimeState.timer) {
        clearInterval(runtimeState.timer);
        runtimeState.timer = null;
    }

    runtimeState.timer = setInterval(() => {
        void runOutboxTick(config);
    }, config.telegramOutboxPollIntervalMs);
    if (typeof runtimeState.timer.unref === 'function') {
        runtimeState.timer.unref();
    }

    await runOutboxTick(config);
    console.log(`Telegram webhook registered at ${webhook.url}`);

    return {
        enabled: true,
        url: webhook.url
    };
}

export async function stopTelegramRuntime() {
    if (runtimeState.timer) {
        clearInterval(runtimeState.timer);
        runtimeState.timer = null;
    }

    resetRuntimeState(false);
}

export async function reloadTelegramRuntime(config) {
    await stopTelegramRuntime();
    return startTelegramRuntime(config);
}

export async function getTelegramRuntimeStatus(config) {
    const outbox = await getTelegramOutboxStats(config);
    const settings = await getPublicTelegramSettings(config);
    return {
        enabled: runtimeState.enabled,
        settings,
        webhookUrl: runtimeState.webhookUrl || null,
        startedAt: runtimeState.startedAt,
        lastWebhookRegisteredAt: runtimeState.lastWebhookRegisteredAt,
        workerActive: runtimeState.workerActive,
        processing: runtimeState.processing,
        lastPollAt: runtimeState.lastPollAt,
        lastDeliveryAt: runtimeState.lastDeliveryAt,
        lastError: runtimeState.lastError || null,
        lastResult: runtimeState.lastResult,
        outbox
    };
}
