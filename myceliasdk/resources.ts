import { EJSON } from "bson";

const MAX_RETRIES = 3;
const INITIAL_DELAY_MS = 500;

/**
 * Fetch with retry for transient connection errors (e.g., backend restarting)
 */
async function fetchWithRetry(url: string, options: RequestInit, retries = MAX_RETRIES): Promise<Response> {
    for (let attempt = 0; attempt <= retries; attempt++) {
        try {
            return await fetch(url, options);
        } catch (err) {
            const message = err instanceof Error ? err.message : String(err);
            const isRetryable = 
                message.toLowerCase().includes("connection refused") ||
                message.includes("ECONNREFUSED") ||
                message.includes("os error 111");

            if (!isRetryable || attempt === retries) {
                throw err;
            }

            const delay = INITIAL_DELAY_MS * Math.pow(2, attempt);
            console.log(`[SDK] Connection failed, retrying in ${delay}ms (attempt ${attempt + 1}/${retries}): ${message}`);
            await new Promise(r => setTimeout(r, delay));
        }
    }
    throw new Error("Should not reach here");
}

export async function callResource<Input, Output>(code: string, input: Input, {
    jwt,
    myceliaUrl,
}: {
    jwt: string;
    myceliaUrl: string;
}): Promise<Output> {
    const response = await fetchWithRetry(`${myceliaUrl}/api/resource/${code}`, {
        method: "POST",
        headers: { "Content-Type": "application/json", "Authorization": `Bearer ${jwt}` },
        body: EJSON.stringify(EJSON.serialize(input)),
    });
    if (!response.ok) {
        let errorDetails = response.statusText;
        try {
            const errorBody = await response.text();
            if (errorBody) {
                try {
                    const parsed = JSON.parse(errorBody);
                    if (parsed.error) {
                        errorDetails = typeof parsed.error === 'string' 
                            ? parsed.error 
                            : JSON.stringify(parsed.error);
                    }
                } catch {
                    // If not JSON, use as-is
                    errorDetails = errorBody;
                }
            }
        } catch {
            // Failed to get error body, use statusText
        }
        throw new Error(`Failed to call resource ${code}: ${errorDetails}`);
    }
    return EJSON.parse(await response.text()) as Output;
}