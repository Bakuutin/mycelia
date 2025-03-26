import path from "path";

export class GoogleCloudImporter extends FileSystemImporter {
  getStart(metadata: { path: string }): Date {
    const filename = path.basename(metadata.path);
    if (!filename) throw new Error("Invalid path");
    const [dateString] = filename.split(".");
    const date = new Date(dateString.replace(/-/g, "/"));
    if (isNaN(date.getTime())) throw new Error("Invalid date format");
    return date;
  }
}
