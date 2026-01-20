import { EJSON } from "bson";


export async function callResource<Input, Output>(code: string, input: Input, {
    jwt,
    myceliaUrl,
}: {
    jwt: string;
    myceliaUrl: string;
}): Promise<Output> {
    const response = await fetch(`${myceliaUrl}/api/resource/${code}`, {
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