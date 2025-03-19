import { create, getNumericDate, CryptoKey } from "@zaubrik/djwt";
import { load } from "@std/dotenv";

async function main() {
  const env = await load();
  const secret = env.SECRET_KEY as string;

  const payload = {
    name: "John Doe",
    exp: getNumericDate(60 * 60), // 1 hour expiration
  };

  const key = await importKey(secret, "HS256");
  const token = await create({ alg: "HS256", typ: "JWT" }, payload, key);

  console.log(token);
}

main();
