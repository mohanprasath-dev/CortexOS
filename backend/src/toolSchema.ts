/**
 * CortexOS – Tool Schema Declarations
 *
 * Defines the structured tool declarations that Gemini uses for function calling.
 * Each tool has a name, description, and strictly typed parameters.
 *
 * These declarations are sent to Gemini during session setup so it can
 * autonomously invoke browser actions via structured JSON tool calls.
 */

// ── Tool Declaration Types ───────────────────────────────────────────────────

export interface ToolParameter {
  type: string;
  description: string;
  enum?: string[];
}

export interface ToolDeclaration {
  name: string;
  description: string;
  parameters: {
    type: 'object';
    properties: Record<string, ToolParameter>;
    required: string[];
  };
}

// ── Tool Names (Enum for Type Safety) ────────────────────────────────────────

export enum ToolName {
  NAVIGATE = 'navigate',
  CLICK = 'click',
  TYPE = 'type',
  EXTRACT = 'extract',
  SUMMARIZE = 'summarize',
  CREATE_CALENDAR_EVENT = 'create_calendar_event',
  SCROLL = 'scroll',
  WAIT_FOR_ELEMENT = 'wait_for_element',
}

// ── Tool Declarations ────────────────────────────────────────────────────────

export const TOOL_DECLARATIONS: ToolDeclaration[] = [
  {
    name: ToolName.NAVIGATE,
    description:
      'Navigate the browser to a specified URL. Use this to open web pages, ' +
      'applications, or any URL-addressable resource in the controlled browser.',
    parameters: {
      type: 'object',
      properties: {
        url: {
          type: 'string',
          description: 'The full URL to navigate to (e.g., "https://example.com")',
        },
      },
      required: ['url'],
    },
  },
  {
    name: ToolName.CLICK,
    description:
      'Click on an element in the browser page identified by a CSS selector. ' +
      'Use this to press buttons, follow links, toggle checkboxes, or interact ' +
      'with any clickable element.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description:
            'CSS selector identifying the element to click (e.g., "#submit-btn", ".nav-link", "button[type=submit]")',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: ToolName.TYPE,
    description:
      'Type text into an input field or text area identified by a CSS selector. ' +
      'The field will be cleared before typing. Use this for filling forms, ' +
      'search boxes, text editors, and any text input.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector identifying the input element to type into',
        },
        text: {
          type: 'string',
          description: 'The text content to type into the field',
        },
      },
      required: ['selector', 'text'],
    },
  },
  {
    name: ToolName.EXTRACT,
    description:
      'Extract the text content from an element identified by a CSS selector. ' +
      'Use this to read page content, scrape data, read error messages, ' +
      'or gather information from the current page.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description:
            'CSS selector identifying the element to extract text from. ' +
            'Use "body" to extract all visible text on the page.',
        },
      },
      required: ['selector'],
    },
  },
  {
    name: ToolName.SUMMARIZE,
    description:
      'Summarize a given text. This is a reasoning tool — pass a block of text ' +
      'and receive a concise summary. Use after extracting content from pages.',
    parameters: {
      type: 'object',
      properties: {
        text: {
          type: 'string',
          description: 'The text content to be summarized',
        },
      },
      required: ['text'],
    },
  },
  {
    name: ToolName.CREATE_CALENDAR_EVENT,
    description:
      'Create a calendar event by navigating to a calendar application and ' +
      'filling in the event details. Provide the date, time, and title for the event.',
    parameters: {
      type: 'object',
      properties: {
        date: {
          type: 'string',
          description: 'Event date in YYYY-MM-DD format (e.g., "2026-02-23")',
        },
        time: {
          type: 'string',
          description: 'Event time in HH:MM format, 24-hour (e.g., "16:00")',
        },
        title: {
          type: 'string',
          description: 'Title/name of the calendar event',
        },
      },
      required: ['date', 'time', 'title'],
    },
  },
  {
    name: ToolName.SCROLL,
    description:
      'Scroll the browser page up or down by a specified amount. Use this to ' +
      'reveal content below or above the current viewport, such as reading long ' +
      'articles, finding buttons further down the page, or scrolling back to the top.',
    parameters: {
      type: 'object',
      properties: {
        direction: {
          type: 'string',
          description: 'Direction to scroll: "up" or "down"',
          enum: ['up', 'down'],
        },
        amount: {
          type: 'string',
          description: 'Number of pixels to scroll (default: 300)',
        },
      },
      required: ['direction'],
    },
  },
  {
    name: ToolName.WAIT_FOR_ELEMENT,
    description:
      'Wait for a specific element to appear on the page. Use this when you expect ' +
      'content to load dynamically (e.g., after a navigation, AJAX call, or animation). ' +
      'Returns true if the element appeared within the timeout, false otherwise.',
    parameters: {
      type: 'object',
      properties: {
        selector: {
          type: 'string',
          description: 'CSS selector of the element to wait for',
        },
        timeout: {
          type: 'string',
          description: 'Maximum time to wait in milliseconds (default: 5000)',
        },
      },
      required: ['selector'],
    },
  },
];

// ── Validation Helpers ───────────────────────────────────────────────────────

/**
 * Validate that a tool name is recognized
 */
export function isValidToolName(name: string): name is ToolName {
  return Object.values(ToolName).includes(name as ToolName);
}

/**
 * Get the declaration for a specific tool
 */
export function getToolDeclaration(name: string): ToolDeclaration | undefined {
  return TOOL_DECLARATIONS.find((t) => t.name === name);
}

/**
 * Validate tool call arguments against the schema
 */
export function validateToolArgs(
  toolName: string,
  args: Record<string, unknown>
): { valid: boolean; errors: string[] } {
  const declaration = getToolDeclaration(toolName);
  if (!declaration) {
    return { valid: false, errors: [`Unknown tool: ${toolName}`] };
  }

  const errors: string[] = [];
  const { properties, required } = declaration.parameters;

  // Check required parameters
  for (const req of required) {
    if (args[req] === undefined || args[req] === null || args[req] === '') {
      errors.push(`Missing required parameter: ${req}`);
    }
  }

  // Check parameter types
  for (const [key, value] of Object.entries(args)) {
    if (!(key in properties)) {
      errors.push(`Unknown parameter: ${key}`);
      continue;
    }
    const expectedType = properties[key].type;
    const actualType = typeof value;
    if (expectedType === 'string' && actualType !== 'string') {
      errors.push(`Parameter "${key}" must be a string, got ${actualType}`);
    }
  }

  return { valid: errors.length === 0, errors };
}
