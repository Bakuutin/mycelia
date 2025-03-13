import jsonwebtoken from "jsonwebtoken";
import 'dotenv/config';


async function main() {

    const secret = process.env.SECRET_KEY as string;

    const payload = {
        name: "John Doe",
    };

    const token = jsonwebtoken.sign(payload, secret);

    console.log(token);
}

main();