import { promises as fs } from "node:fs";
import path from "node:path";


async function getFiles(dir: string) {
    const files = await fs.readdir(dir);
    return files.map(file => path.join(dir, file));
}

async function getFileMetadata(file: string) {
    const stats = await fs.stat(file);
    return { name: file, size: stats.size, created: stats.birthtime };
}


console.log(await getFiles("/Users/igor/Projects/mycelia-deno/app/lib/importers"));
console.log(await getFileMetadata("/Users/igor/Projects/mycelia-deno/app/lib/importers/AppleVoiceMemosImporter.ts"));

