/**
 * Error handling utilities for Gemini API
 */

import { Response } from 'node-fetch';
import { formatMessage } from './textUtils';
import {
    GeminiError,
    RateLimitError,
    AuthenticationError,
    ContentBlockedError,
    InvalidRequestError,
    ServerError,
    NetworkError,
    ResponseFormatError
} from './errors';

/**
 * Parse HTTP error response and throw appropriate error
 */
export async function handleHttpError(response: Response): Promise<never> {
    const statusCode = response.status;
    const statusText = response.statusText;
    let errorBody: string;

    try {
        errorBody = await response.text();
    } catch {
        errorBody = 'Unable to read error response';
    }

    // Parse error details from response body if available
    let errorDetails = errorBody;
    try {
        const errorJson = JSON.parse(errorBody);
        if (errorJson.error && errorJson.error.message) {
            errorDetails = errorJson.error.message;
        }
    } catch {
        // Not JSON, use raw text
    }

    // Handle different status codes
    switch (statusCode) {
        case 429:
            throw new RateLimitError(
                '⚠️ Rate limit exceeded (429)\n\n' +
                'Please wait at least 1 minute before trying again.\n\n' +
                'Tips:\n' +
                '• Process fewer images at once\n' +
                '• Use decorative keywords to skip images\n' +
                '• Wait longer between batch operations'
            );

        case 401:
            throw new AuthenticationError(
                '🔑 Authentication failed (401)\n\n' +
                'Invalid or missing API key.\n\n' +
                'Solution:\n' +
                '• Check your API key in settings\n' +
                '• Get a new key from Google AI Studio',
                401
            );

        case 403:
            throw new AuthenticationError(
                '🚫 Access forbidden (403)\n\n' +
                'API key lacks permissions or service disabled.\n\n' +
                'Solution:\n' +
                '• Verify API key permissions\n' +
                '• Check if Gemini API is enabled',
                403
            );

        case 400:
            throw new InvalidRequestError(
                formatMessage(
                    '❌ Bad request (400)\n\n' +
                    '{0}',
                    errorDetails
                ),
                400
            );

        case 404:
            throw new InvalidRequestError(
                '❌ API endpoint not found (404)\n\n' +
                'Invalid model name or API version.\n\n' +
                'Solution:\n' +
                '• Check the selected model in settings',
                404
            );

        case 500:
        case 502:
        case 503:
        case 504:
            throw new ServerError(
                formatMessage(
                    '🔧 Server error ({0})\n\n' +
                    'Gemini API server encountered an error.\n' +
                    'This is usually temporary. Try again in a moment.',
                    statusCode.toString()
                ),
                statusCode
            );

        default:
            // Unknown error
            throw new GeminiError(
                formatMessage(
                    '❌ API Error ({0})\n\n' +
                    '{1}',
                    statusCode.toString(),
                    errorDetails
                ),
                statusCode,
                statusCode >= 500 // 5xx errors are generally retryable
            );
    }
}

/**
 * Handle content blocked error from promptFeedback
 */
export function handleContentBlocked(blockReason: string, contentType: 'image' | 'video'): never {
    const contentLabel = contentType === 'image' ? 'ALT' : 'aria-label';
    let errorMessage = `🚫 Content blocked by Gemini API\n\n`;

    switch (blockReason) {
        case 'SAFETY':
            errorMessage += `Reason: Safety filter\n\n` +
                `Solution:\n` +
                `• Use a different ${contentType}\n` +
                `• Manually write ${contentLabel}`;
            break;

        case 'OTHER':
            errorMessage += `Reason: Unspecified\n\n` +
                `Solution:\n` +
                `• Try a different ${contentType}\n` +
                `• Manually write ${contentLabel}`;
            break;

        case 'BLOCKLIST':
            errorMessage += `Reason: Blocklist\n\n` +
                `Solution:\n` +
                `• Use a different ${contentType}\n` +
                `• Manually write ${contentLabel}`;
            break;

        case 'PROHIBITED_CONTENT':
            errorMessage += `Reason: Prohibited content\n\n` +
                `Solution:\n` +
                `• Use a different ${contentType}\n` +
                `• Manually write ${contentLabel}`;
            break;

        default:
            errorMessage += `Reason: ${blockReason}\n\n` +
                `Solution:\n` +
                `• Try a different ${contentType}\n` +
                `• Manually write ${contentLabel}`;
    }

    throw new ContentBlockedError(errorMessage, blockReason);
}

/**
 * Validate API response structure
 */
export function validateResponseStructure(data: any): void {
    // Check candidates array
    if (!data.candidates || !Array.isArray(data.candidates) || data.candidates.length === 0) {
        console.error('Unexpected API response:', JSON.stringify(data, null, 2));
        throw new ResponseFormatError(
            '❌ Unexpected API response format\n\n' +
            'Missing "candidates" array.\n' +
            'Check developer console for details.'
        );
    }

    // Check content structure
    const candidate = data.candidates[0];
    if (!candidate.content || !candidate.content.parts || !Array.isArray(candidate.content.parts) || candidate.content.parts.length === 0) {
        console.error('Unexpected API response:', JSON.stringify(data, null, 2));
        throw new ResponseFormatError(
            '❌ Invalid API response structure\n\n' +
            'Missing content or parts.\n' +
            'Check developer console for details.'
        );
    }

    // Check if text is present
    if (!candidate.content.parts[0].text) {
        console.error('Unexpected API response:', JSON.stringify(data, null, 2));
        throw new ResponseFormatError(
            '❌ Empty API response\n\n' +
            'No generated text returned.\n' +
            'Check developer console for details.'
        );
    }
}

/**
 * Check if error is retryable
 */
export function isRetryableError(error: any): boolean {
    if (error instanceof GeminiError) {
        return error.isRetryable;
    }

    // Network errors are typically retryable
    if (error instanceof NetworkError) {
        return true;
    }

    // Unknown errors are not retryable by default
    return false;
}

/**
 * Get user-friendly error message
 */
export function getUserFriendlyErrorMessage(error: any): string {
    if (error instanceof GeminiError) {
        return error.message;
    }

    // Handle fetch/network errors
    if (error.name === 'FetchError' || error.code === 'ENOTFOUND' || error.code === 'ECONNREFUSED') {
        return '🌐 Network error\n\n' +
            'Unable to connect to Gemini API.\n\n' +
            'Solution:\n' +
            '• Check internet connection\n' +
            '• Check firewall settings';
    }

    // Timeout errors
    if (error.name === 'AbortError' || error.message?.includes('timeout')) {
        return '⏱️ Request timeout\n\n' +
            'API request took too long.\n\n' +
            'Solution:\n' +
            '• Try with smaller file\n' +
            '• Check connection speed';
    }

    // Generic error
    return error.message || '❌ Unexpected error';
}
