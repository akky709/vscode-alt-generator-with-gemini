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
                'Rate limit exceeded (429 Too Many Requests).\n\n' +
                'Possible causes:\n' +
                '1. Too many requests per minute (RPM limit)\n' +
                '2. Too many tokens per minute (TPM limit)\n\n' +
                'Solutions:\n' +
                '• Wait 1 minute and try again\n' +
                '• Process fewer images at once\n' +
                '• Use decorative keywords to skip unnecessary images'
            );

        case 401:
            throw new AuthenticationError(
                'Authentication failed (401 Unauthorized).\n\n' +
                'Possible causes:\n' +
                '1. Invalid API key\n' +
                '2. API key not set\n\n' +
                'Solution:\n' +
                '• Check your Gemini API key in settings\n' +
                '• Get a valid API key from Google AI Studio',
                401
            );

        case 403:
            throw new AuthenticationError(
                'Access forbidden (403 Forbidden).\n\n' +
                'Possible causes:\n' +
                '1. API key lacks necessary permissions\n' +
                '2. API access restricted for your region\n' +
                '3. Service disabled for your project\n\n' +
                'Solution:\n' +
                '• Verify your API key permissions\n' +
                '• Check if Gemini API is enabled for your project',
                403
            );

        case 400:
            throw new InvalidRequestError(
                formatMessage(
                    'Bad request (400).\n\n' +
                    'Error details: {0}\n\n' +
                    'The request format may be invalid or contain unsupported content.',
                    errorDetails
                ),
                400
            );

        case 404:
            throw new InvalidRequestError(
                'API endpoint not found (404).\n\n' +
                'This may indicate:\n' +
                '1. Invalid model name\n' +
                '2. API version mismatch\n\n' +
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
                    'Server error ({0} {1}).\n\n' +
                    'The Gemini API server encountered an error.\n\n' +
                    'This is usually temporary. Please try again in a moment.\n' +
                    'If the problem persists, check Google Cloud status.',
                    statusCode.toString(),
                    statusText
                ),
                statusCode
            );

        default:
            // Unknown error
            throw new GeminiError(
                formatMessage(
                    'API Error {0}: {1}\n\n' +
                    'Details: {2}',
                    statusCode.toString(),
                    statusText,
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
    let errorMessage = 'Gemini API blocked the request.\n\n';

    switch (blockReason) {
        case 'SAFETY':
            errorMessage += `Reason: Safety filter triggered.\n` +
                `The ${contentType} may contain content that violates safety policies.\n\n` +
                `Solution:\n` +
                `• Use a different ${contentType}\n` +
                `• Manually write the ${contentType === 'image' ? 'alt text' : 'aria-label'}`;
            break;

        case 'OTHER':
            errorMessage += `Reason: Content was blocked for unspecified reasons.\n` +
                `This may happen with certain types of ${contentType}s or content.\n\n` +
                `Solution:\n` +
                `• Try with a different ${contentType}\n` +
                `• Manually write the ${contentType === 'image' ? 'alt text' : 'aria-label'}`;
            break;

        case 'BLOCKLIST':
            errorMessage += `Reason: Content matches a blocklist.\n\n` +
                `Solution:\n` +
                `• Use a different ${contentType}\n` +
                `• Manually write the ${contentType === 'image' ? 'alt text' : 'aria-label'}`;
            break;

        case 'PROHIBITED_CONTENT':
            errorMessage += `Reason: Prohibited content detected.\n` +
                `The ${contentType} contains content that is not allowed by the API.\n\n` +
                `Solution:\n` +
                `• Use a different ${contentType}\n` +
                `• Manually write the ${contentType === 'image' ? 'alt text' : 'aria-label'}`;
            break;

        default:
            errorMessage += `Reason: ${blockReason}\n\n` +
                `Solution:\n` +
                `• Try with a different ${contentType}\n` +
                `• Manually write the ${contentType === 'image' ? 'alt text' : 'aria-label'}`;
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
            'API returned an unexpected response format.\n\n' +
            'The response is missing the expected "candidates" array.\n' +
            'Check the developer console for full response details.'
        );
    }

    // Check content structure
    const candidate = data.candidates[0];
    if (!candidate.content || !candidate.content.parts || !Array.isArray(candidate.content.parts) || candidate.content.parts.length === 0) {
        console.error('Unexpected API response:', JSON.stringify(data, null, 2));
        throw new ResponseFormatError(
            'API response is missing expected content.\n\n' +
            'The response structure is incomplete or invalid.\n' +
            'Check the developer console for full response details.'
        );
    }

    // Check if text is present
    if (!candidate.content.parts[0].text) {
        console.error('Unexpected API response:', JSON.stringify(data, null, 2));
        throw new ResponseFormatError(
            'API response does not contain generated text.\n\n' +
            'The API may have returned an empty response.\n' +
            'Check the developer console for full response details.'
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
        return 'Network error: Unable to connect to Gemini API.\n\n' +
            'Possible causes:\n' +
            '1. No internet connection\n' +
            '2. Firewall blocking the request\n' +
            '3. Proxy configuration issues\n\n' +
            'Solution:\n' +
            '• Check your internet connection\n' +
            '• Check firewall settings';
    }

    // Timeout errors
    if (error.name === 'AbortError' || error.message?.includes('timeout')) {
        return 'Request timeout.\n\n' +
            'The API request took too long to complete.\n\n' +
            'Solution:\n' +
            '• Try again with a smaller image/video\n' +
            '• Check your internet connection speed';
    }

    // Generic error
    return error.message || 'An unexpected error occurred';
}
