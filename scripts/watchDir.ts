const [dir] = Deno.args;

if (!dir) {
  console.error("Directory path required");
  Deno.exit(1);
}

const seenFiles = new Set<string>();

async function listNewFiles() {
  try {
    const entries = Deno.readDir(dir);
    const currentFiles = new Set<string>();

    for await (const entry of entries) {
      if (entry.isFile) {
        const fullPath = `${dir}/${entry.name}`;
        currentFiles.add(fullPath);

        if (!seenFiles.has(fullPath)) {
          console.log(fullPath);
          seenFiles.add(fullPath);
        }
      }
    }
  } catch (error) {
    console.error("Error listing directory:", error);
  }
}

const cleanup = async () => {
  await listNewFiles();
  Deno.exit(0);
};

Deno.addSignalListener("SIGINT", cleanup);
Deno.addSignalListener("SIGTERM", cleanup);

await listNewFiles();

for await (const event of Deno.watchFs(dir, { recursive: false })) {
  await listNewFiles();
}
