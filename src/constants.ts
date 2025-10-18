/**
 * Application constants
 * Centralized location for all magic numbers and configuration values
 */

/**
 * API and Network Configuration
 */
export const API_CONFIG = {
    /** Default Gemini API model */
    DEFAULT_MODEL: 'gemini-2.5-flash',
    /** Maximum number of retry attempts for retryable errors */
    MAX_RETRIES: 2,
    /** Base wait time in milliseconds for retry (multiplied by attempt number) */
    RETRY_WAIT_BASE_MS: 1000,
    /** Maximum video file size in MB */
    MAX_VIDEO_SIZE_MB: 20,
} as const;

/**
 * Text Processing Configuration
 */
export const TEXT_PROCESSING = {
    /** Maximum search range in characters for parent/sibling element detection */
    MAX_SEARCH_RANGE: 5000,
    /** Maximum number of parent element levels to traverse */
    MAX_PARENT_LEVELS: 3,
    /** Maximum number of sibling elements to collect (before + after) */
    MAX_SIBLINGS: 3,
    /** Minimum text length in characters to consider context sufficient */
    MIN_CONTEXT_LENGTH: 50,
} as const;

/**
 * Tag Detection Configuration
 */
export const TAG_DETECTION = {
    /** Timeout in milliseconds for tag search operations */
    SEARCH_TIMEOUT_MS: 5000,
    /** Maximum attribute length for regex matching */
    MAX_ATTRIBUTE_LENGTH: 1000,
} as const;

/**
 * Selection Thresholds
 * Used to determine empty selections and minimum tag text length
 */
export const SELECTION_THRESHOLDS = {
    /** Minimum selection length to be considered non-empty */
    MIN_SELECTION_LENGTH: 5,
    /** Minimum tag text length for detection */
    MIN_TAG_TEXT_LENGTH: 10,
} as const;

/**
 * Character Constraints for ALT Text Generation
 * Used in prompts to constrain the length of generated descriptions
 */
export const CHAR_CONSTRAINTS = {
    /** Standard length for English ALT text */
    STANDARD_EN: '60 and 130 characters',
    /** Detailed length for English ALT text */
    DETAILED_EN: '100 and 200 characters',
    /** Standard length for Japanese ALT text */
    STANDARD_JA: '50 and 120 Japanese characters (full-width characters)',
    /** Detailed length for Japanese ALT text */
    DETAILED_JA: '100 and 200 Japanese characters (full-width characters)',
    /** Default fallback constraint */
    DEFAULT: '50 and 120 characters',
} as const;

/**
 * Prompt Configuration
 * Numbers used in prompt instructions
 */
export const PROMPT_CONSTRAINTS = {
    /** Minimum number of SEO keywords */
    SEO_KEYWORDS_MIN: 3,
    /** Maximum number of SEO keywords */
    SEO_KEYWORDS_MAX: 5,
    /** Maximum characters for supplementary description when context partially describes */
    MAX_SUPPLEMENTARY_CHARS: 50,
    /** Maximum words for supplementary video description */
    MAX_SUPPLEMENTARY_WORDS_VIDEO: 5,
    /** Maximum words for video aria-label */
    MAX_VIDEO_ARIA_LABEL_WORDS: 10,
} as const;

/**
 * JSON Formatting
 */
export const JSON_FORMATTING = {
    /** Indentation spaces for JSON.stringify */
    INDENT_SPACES: 2,
} as const;

/**
 * UI Messages
 */
export const UI_MESSAGES = {
    /** Prefix for image progress messages */
    IMAGE_PREFIX: '[IMG]',
    /** Prefix for video progress messages */
    VIDEO_PREFIX: '[VIDEO]',
} as const;

/**
 * Context Range Values
 * Mapping from configuration string to actual character count
 */
export const CONTEXT_RANGE_VALUES = {
    'narrow': 500,
    'standard': 1500,
    'wide': 3000,
    'very-wide': 5000,
    /** Default fallback value */
    'default': 1500,
} as const;

/**
 * Special Keywords
 */
export const SPECIAL_KEYWORDS = {
    /** Keyword returned by API to indicate decorative/redundant content */
    DECORATIVE: 'DECORATIVE',
} as const;
