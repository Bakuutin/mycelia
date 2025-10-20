import { EJSON } from "bson";

export const callResource = async (resource: string, body: any) => {
  const res = await fetch(`/api/resource/${resource}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: EJSON.stringify(body),
  });
  return EJSON.parse(await res.text());
};
