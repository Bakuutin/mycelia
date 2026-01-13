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
        throw new Error(`Failed to call resource ${code}: ${response.statusText}`);
    }
    return EJSON.parse(await response.text()) as Output;
}