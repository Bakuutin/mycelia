import { exit } from "node:process";
import { queue } from "./shared.ts";

await queue.add("job", { foo: new Date().toISOString() });

exit(0);
