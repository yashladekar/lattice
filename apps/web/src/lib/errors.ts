/**
 * Turns whatever the browser, IndexedDB, or the server threw into a sentence
 * someone can act on, and keeps the original text for the copy-details action.
 *
 * Every rule names the cause and the next step. Nothing here apologises, and
 * nothing blames the reader.
 */
export interface HumanError {
  message: string;
  detail: string;
}

interface Rule {
  test: RegExp;
  message: string;
}

const RULES: Rule[] = [
  {
    test: /failed to fetch|networkerror|load failed|network request failed|econnrefused/i,
    message: "Lattice could not reach the sync server. Check your connection and try again.",
  },
  {
    test: /idbobjectstore|idbdatabase|dataerror|quotaexceeded|invalidstateerror|indexeddb/i,
    message:
      "Lattice could not save to this device's storage. Free up some space, or open it in a private window for a quick look.",
  },
  {
    test: /unauthorized|401|session expired|invalid session/i,
    message: "Your session expired. Sign in again to keep syncing.",
  },
  {
    test: /snapshot did not finish|invalid workspace snapshot/i,
    message: "The workspace download did not finish. Retry to start it again.",
  },
  {
    test: /not_found|workspace not found|page not found|no such/i,
    message: "That item is not on this device yet. Retry, or sign in again.",
  },
  {
    test: /abort|timeout|timed out/i,
    message: "That took too long and stopped. Try again.",
  },
];

const GENERIC = "Something went wrong. Retry, and copy the details if it keeps happening.";

function detailOf(error: unknown): string {
  if (error instanceof Error) {
    return error.name && error.name !== "Error" ? `${error.name}: ${error.message}` : error.message;
  }
  if (typeof error === "string") return error;
  if (error === null || error === undefined) return "";
  try {
    return JSON.stringify(error) ?? String(error);
  } catch {
    return String(error);
  }
}

export function humanizeError(error: unknown, fallback: string = GENERIC): HumanError {
  const detail = detailOf(error);
  const rule = RULES.find((entry) => entry.test.test(detail));
  return { message: rule?.message ?? fallback, detail };
}

export async function copyErrorDetail(detail: string): Promise<boolean> {
  if (!detail) return false;
  try {
    await navigator.clipboard.writeText(detail);
    return true;
  } catch {
    return false;
  }
}
