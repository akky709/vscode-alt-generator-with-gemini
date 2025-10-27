/**
 * Gemini API integration
 */

import * as vscode from 'vscode';
import fetch, { Response } from 'node-fetch';
import { getDefaultPrompt } from './prompts';
import { getOutputLanguage } from '../utils/config';
import { CancellationError, NetworkError } from '../utils/errors';
import { handleHttpError, handleContentBlocked, validateResponseStructure, isRetryableError } from '../utils/errorHandler';
import { API_CONFIG, JSON_FORMATTING, CHAR_CONSTRAINTS } from '../constants';


/**
 * Gemini API response structure
 * Defines the expected JSON structure from Gemini API generateContent endpoint
 */
interface GeminiResponse {
    candidates: Array<{
        content: {
            parts: Array<{
                text: string;
            }>;
        };
    }>;
    promptFeedback?: {
        blockReason?: string;
    };
}

/**
 * Fetch from Gemini API with error handling
 */
async function fetchGeminiAPI(
    url: string,
    apiKey: string,
    requestBody: object,
    token?: vscode.CancellationToken
): Promise<Response> {
    if (token?.isCancellationRequested) {
        throw new CancellationError();
    }

    try {
        return await fetch(url, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-goog-api-key': apiKey
            },
            body: JSON.stringify(requestBody)
        });
    } catch (error: unknown) {
        const errorMessage = error instanceof Error ? error.message : 'Unknown error';
        throw new NetworkError(
            'Failed to connect to Gemini API.\n\n' +
            'Possible causes:\n' +
            '1. No internet connection\n' +
            '2. Network firewall blocking the request\n' +
            '3. DNS resolution failed\n\n' +
            `Error details: ${errorMessage}`
        );
    }
}

/**
 * Validate Gemini API response and extract data
 */
async function validateGeminiResponse(
    response: Response,
    contentType: 'image' | 'video',
    token?: vscode.CancellationToken
): Promise<GeminiResponse> {
    if (token?.isCancellationRequested) {
        throw new CancellationError();
    }

    if (!response.ok) {
        await handleHttpError(response);
    }

    const data: unknown = await response.json();

    // Check for content blocked
    if (typeof data === 'object' && data !== null && 'promptFeedback' in data) {
        const dataObj = data as { promptFeedback?: { blockReason?: string } };
        if (dataObj.promptFeedback?.blockReason) {
            console.error('API blocked the request:', JSON.stringify(data, null, JSON_FORMATTING.INDENT_SPACES));
            handleContentBlocked(dataObj.promptFeedback.blockReason, contentType);
        }
    }

    validateResponseStructure(data);
    return data as GeminiResponse;
}

/**
 * Generate ALT text for an image using Gemini API
 */
export async function generateAltText(
    apiKey: string,
    base64Image: string,
    mimeType: string,
    mode: string,
    model: string,
    token?: vscode.CancellationToken,
    surroundingText?: string
): Promise<string> {
    // キャンセルチェック
    if (token?.isCancellationRequested) {
        throw new Error('Cancelled');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    // 出力言語を取得
    const outputLang = getOutputLanguage();

    // 設定からプロンプトを取得
    let prompt: string;

    if (mode === 'A11Y') {
        // A11Yモード - 常に標準の文字数制約を使用
        const charLengthConstraint = outputLang === 'ja'
            ? CHAR_CONSTRAINTS.STANDARD_JA
            : CHAR_CONSTRAINTS.STANDARD_EN;

        prompt = getDefaultPrompt('a11y', outputLang as 'en' | 'ja', {
            mode: 'standard',
            charConstraint: charLengthConstraint,
            surroundingText
        });
    } else {
        // SEOモード
        prompt = getDefaultPrompt('seo', outputLang as 'en' | 'ja', {
            surroundingText
        });
    }

    // デバッグ: 送信するプロンプトをコンソールに表示
    console.log('[ALT Generator] ========================================');
    console.log('[ALT Generator] Prompt sent to Gemini API (Image):');
    console.log('[ALT Generator] Mode:', mode);
    console.log('[ALT Generator] Model:', model);
    console.log('[ALT Generator] ========================================');
    console.log(prompt);
    console.log('[ALT Generator] ========================================');

    const requestBody = {
        contents: [{
            parts: [
                {
                    text: prompt
                },
                {
                    inline_data: {
                        mime_type: mimeType,
                        data: base64Image
                    }
                }
            ]
        }]
    };

    const response = await fetchGeminiAPI(url, apiKey, requestBody, token);
    const validatedData = await validateGeminiResponse(response, 'image', token);
    const altText = validatedData.candidates[0].content.parts[0].text.trim();

    return altText;
}

/**
 * Generate aria-label for video using Gemini API
 */
export async function generateVideoAriaLabel(
    apiKey: string,
    base64Video: string,
    mimeType: string,
    model: string,
    token?: vscode.CancellationToken,
    surroundingText?: string,
    mode: 'standard' | 'detailed' = 'standard'
): Promise<string> {
    // キャンセルチェック
    if (token?.isCancellationRequested) {
        throw new Error('Cancelled');
    }

    const url = `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`;

    // 出力言語を取得
    const outputLang = getOutputLanguage();

    // プロンプトを取得
    const prompt = getDefaultPrompt('video', outputLang as 'en' | 'ja', {
        surroundingText,
        mode
    });

    // デバッグ: 送信するプロンプトをコンソールに表示
    console.log('[ALT Generator] ========================================');
    console.log('[ALT Generator] Prompt sent to Gemini API (Video):');
    console.log('[ALT Generator] Mode:', mode);
    console.log('[ALT Generator] Model:', model);
    console.log('[ALT Generator] ========================================');
    console.log(prompt);
    console.log('[ALT Generator] ========================================');

    const requestBody = {
        contents: [{
            parts: [
                {
                    text: prompt
                },
                {
                    inline_data: {
                        mime_type: mimeType,
                        data: base64Video
                    }
                }
            ]
        }]
    };

    const response = await fetchGeminiAPI(url, apiKey, requestBody, token);
    const validatedData = await validateGeminiResponse(response, 'video', token);
    const ariaLabel = validatedData.candidates[0].content.parts[0].text.trim();

    return ariaLabel;
}

/**
 * Generate ALT text with automatic retry for retryable errors
 * Only retries network errors and server errors (5xx)
 * Does NOT retry rate limit errors (429) - user must wait
 */
export async function generateAltTextWithRetry(
    apiKey: string,
    base64Image: string,
    mimeType: string,
    mode: string,
    model: string,
    token?: vscode.CancellationToken,
    surroundingText?: string,
    maxRetries: number = API_CONFIG.MAX_RETRIES
): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // キャンセルチェック
            if (token?.isCancellationRequested) {
                throw new CancellationError();
            }

            return await generateAltText(
                apiKey,
                base64Image,
                mimeType,
                mode,
                model,
                token,
                surroundingText
            );
        } catch (error: unknown) {
            lastError = error instanceof Error ? error : new Error('Unknown error');

            // キャンセルエラーは即座に投げる
            if (error instanceof CancellationError || token?.isCancellationRequested) {
                throw error;
            }

            // リトライ不可能なエラーは即座に投げる
            if (!isRetryableError(error)) {
                throw error;
            }

            // 最後の試行でエラーが出た場合は投げる
            if (attempt === maxRetries - 1) {
                throw error;
            }

            // Short wait for network/server errors
            const waitTime = API_CONFIG.RETRY_WAIT_BASE_MS * (attempt + 1);
            console.log(`[ALT Generator] Retrying after network/server error (attempt ${attempt + 1}/${maxRetries}, waiting ${waitTime}ms)`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }

    throw lastError || new Error('Unknown error during retry');
}

/**
 * Generate aria-label with automatic retry for retryable errors
 * Only retries network errors and server errors (5xx)
 * Does NOT retry rate limit errors (429) - user must wait
 */
export async function generateVideoAriaLabelWithRetry(
    apiKey: string,
    base64Video: string,
    mimeType: string,
    model: string,
    token?: vscode.CancellationToken,
    surroundingText?: string,
    maxRetries: number = API_CONFIG.MAX_RETRIES,
    mode: 'standard' | 'detailed' = 'standard'
): Promise<string> {
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            // キャンセルチェック
            if (token?.isCancellationRequested) {
                throw new CancellationError();
            }

            return await generateVideoAriaLabel(
                apiKey,
                base64Video,
                mimeType,
                model,
                token,
                surroundingText,
                mode
            );
        } catch (error: unknown) {
            lastError = error instanceof Error ? error : new Error('Unknown error');

            // キャンセルエラーは即座に投げる
            if (error instanceof CancellationError || token?.isCancellationRequested) {
                throw error;
            }

            // リトライ不可能なエラーは即座に投げる
            if (!isRetryableError(error)) {
                throw error;
            }

            // 最後の試行でエラーが出た場合は投げる
            if (attempt === maxRetries - 1) {
                throw error;
            }

            // Short wait for network/server errors
            const waitTime = API_CONFIG.RETRY_WAIT_BASE_MS * (attempt + 1);
            console.log(`[ALT Generator] Retrying after network/server error (attempt ${attempt + 1}/${maxRetries}, waiting ${waitTime}ms)`);
            await new Promise(resolve => setTimeout(resolve, waitTime));
        }
    }

    throw lastError || new Error('Unknown error during retry');
}
