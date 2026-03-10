/**
 * CortexOS – Config Validator
 *
 * Validates all required environment variables and configuration at startup.
 * Prevents the server from booting with invalid or missing config that would
 * cause runtime failures (e.g., invalid model names, missing project IDs).
 *
 * Called once during server initialization, before any session is created.
 */

import { logger } from './logger';

// ── Types ────────────────────────────────────────────────────────────────────

export interface ConfigValidationResult {
  valid: boolean;
  errors: string[];
  warnings: string[];
  config: ValidatedConfig;
}

export interface ValidatedConfig {
  projectId: string;
  location: string;
  modelName: string;
  port: number;
  hasCredentials: boolean;
}

// ── Allowed Values ───────────────────────────────────────────────────────────

/** Known-good Gemini Live model names for Vertex AI BidiGenerateContent */
const ALLOWED_MODEL_NAMES = [
  'gemini-2.0-flash-live',
  'gemini-2.0-flash',
  'gemini-2.0-flash-exp',
  'gemini-2.5-flash-preview-native-audio-dialog',
  'gemini-2.5-flash',
];

/** Valid GCP regions for Vertex AI */
const ALLOWED_LOCATIONS = [
  'us-central1',
  'us-east1',
  'us-east4',
  'us-west1',
  'us-west4',
  'europe-west1',
  'europe-west4',
  'asia-northeast1',
  'asia-southeast1',
];

/** WebSocket close code descriptions for human-readable logging */
export const WS_CLOSE_CODES: Record<number, string> = {
  1000: 'Normal Closure – session ended cleanly',
  1001: 'Going Away – server shutting down',
  1002: 'Protocol Error – malformed WebSocket frame',
  1003: 'Unsupported Data – invalid payload type',
  1006: 'Abnormal Closure – connection dropped without close frame',
  1007: 'Invalid Payload – message encoding error',
  1008: 'Policy Violation – invalid model, auth failure, or request rejected',
  1009: 'Message Too Big – payload exceeds server limit',
  1011: 'Internal Error – unexpected server-side failure',
  1012: 'Service Restart – server is restarting',
  1013: 'Try Again Later – server temporarily unavailable',
  1014: 'Bad Gateway – upstream connection failure',
  1015: 'TLS Handshake Failure – certificate/TLS error',
};

/**
 * Returns a human-readable description for a WebSocket close code.
 */
export function describeCloseCode(code: number): string {
  return WS_CLOSE_CODES[code] || `Unknown close code: ${code}`;
}

// ── Validator ────────────────────────────────────────────────────────────────

/**
 * Validate all critical environment variables at startup.
 * Returns a structured result with errors and warnings.
 */
export function validateConfig(): ConfigValidationResult {
  const errors: string[] = [];
  const warnings: string[] = [];

  // ── Required: PROJECT_ID ───────────────────────────────────────────────
  const projectId = process.env.PROJECT_ID || '';
  const isDemoMode = process.env.DEMO_MODE === 'true';

  if (!projectId) {
    if (isDemoMode) {
      warnings.push(
        'PROJECT_ID is not set, but DEMO_MODE is enabled. ' +
        'Using mock Gemini client — no real AI capabilities.'
      );
    } else {
      errors.push('PROJECT_ID is required. Set it in .env or environment. ' +
        'Or set DEMO_MODE=true to run without GCP credentials.');
    }
  } else if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(projectId)) {
    warnings.push(
      `PROJECT_ID "${projectId}" does not match typical GCP project ID format. ` +
      'Verify it is correct.'
    );
  }

  // ── Required: LOCATION ─────────────────────────────────────────────────
  const location = process.env.LOCATION || 'us-central1';
  if (!ALLOWED_LOCATIONS.includes(location)) {
    warnings.push(
      `LOCATION "${location}" is not in the known Vertex AI regions: ` +
      `${ALLOWED_LOCATIONS.join(', ')}. Connection may fail.`
    );
  }

  // ── Required: GEMINI_MODEL_NAME ────────────────────────────────────────
  const modelName = process.env.GEMINI_MODEL_NAME || 'gemini-2.0-flash-live';
  if (!modelName) {
    errors.push('GEMINI_MODEL_NAME is required.');
  } else if (!ALLOWED_MODEL_NAMES.includes(modelName)) {
    errors.push(
      `GEMINI_MODEL_NAME "${modelName}" is not a known valid model. ` +
      `Allowed models: ${ALLOWED_MODEL_NAMES.join(', ')}. ` +
      'Using an invalid model will cause WebSocket 1008 (Policy Violation).'
    );
  }

  // ── Credentials ────────────────────────────────────────────────────────
  const credsPath = process.env.GOOGLE_APPLICATION_CREDENTIALS || '';
  const hasCredentials = !!credsPath;
  if (!hasCredentials) {
    warnings.push(
      'GOOGLE_APPLICATION_CREDENTIALS is not set. ' +
      'Ensure ADC is available (e.g., on Cloud Run or via gcloud auth).'
    );
  }

  // ── Ports ──────────────────────────────────────────────────────────────
  const port = parseInt(process.env.PORT || '8080', 10);
  if (isNaN(port) || port < 1 || port > 65535) {
    errors.push(`Invalid PORT: ${process.env.PORT}. Must be 1-65535.`);
  }

  // ── Guard: No API keys present ─────────────────────────────────────────
  if (process.env.GEMINI_API_KEY || process.env.API_KEY || process.env.GOOGLE_API_KEY) {
    errors.push(
      'API key environment variables detected (GEMINI_API_KEY / API_KEY / GOOGLE_API_KEY). ' +
      'CortexOS uses Vertex AI with OAuth2 — remove all API key variables.'
    );
  }

  const result: ConfigValidationResult = {
    valid: errors.length === 0,
    errors,
    warnings,
    config: { projectId, location, modelName, port, hasCredentials },
  };

  // ── Log validation results ─────────────────────────────────────────────
  if (errors.length > 0) {
    logger.error('CONFIG VALIDATION FAILED:');
    errors.forEach((e) => logger.error(`  ✗ ${e}`));
  }
  if (warnings.length > 0) {
    warnings.forEach((w) => logger.warn(`  ⚠ ${w}`));
  }
  if (result.valid) {
    logger.info(
      'Config validation passed: ' +
      `project=${projectId}, location=${location}, model=${modelName}`
    );
  }

  return result;
}

/**
 * Run validation and throw if critical errors are found.
 * Used at server startup to fail fast.
 */
export function validateConfigOrDie(): ValidatedConfig {
  const result = validateConfig();
  if (!result.valid) {
    const errMsg =
      'CortexOS cannot start due to configuration errors:\n' +
      result.errors.map((e) => `  • ${e}`).join('\n');
    logger.error(errMsg);
    throw new Error(errMsg);
  }
  return result.config;
}
