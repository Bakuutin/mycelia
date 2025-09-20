import React, { useMemo, useState } from "react";
import { useFetcher } from "@remix-run/react";

import { Button } from "@/components/ui/button.tsx";
import { Input } from "@/components/ui/input.tsx";
import { Label } from "@/components/ui/label.tsx";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card.tsx";

type UploadResponse = {
  success: boolean;
  file_id: string;
  size: number;
};

function formatBytes(bytes: number): string {
  const units = ["B", "KB", "MB", "GB", "TB"];
  if (bytes === 0) return "0 B";
  const i = Math.floor(Math.log(bytes) / Math.log(1024));
  const value = bytes / Math.pow(1024, i);
  return `${value.toFixed(value >= 100 ? 0 : value >= 10 ? 1 : 2)} ${units[i]}`;
}

export default function UploadTracks() {
  const fetcher = useFetcher<UploadResponse>();
  const [title, setTitle] = useState("");
  const [artist, setArtist] = useState("");

  const metadata = useMemo(() => ({
    kind: "track",
    title: title || undefined,
    artist: artist || undefined,
  }), [title, artist]);

  const isUploading = fetcher.state !== "idle" && fetcher.state !== undefined;
  const result = fetcher.data;

  return (
    <div className="max-w-2xl mx-auto p-6">
      <Card>
        <CardHeader>
          <CardTitle>Upload Track</CardTitle>
        </CardHeader>
        <CardContent>
          <fetcher.Form
            method="post"
            encType="multipart/form-data"
            action="/api/files/upload"
            className="space-y-4"
          >
            <input type="hidden" name="metadata" value={JSON.stringify(metadata)} />

            <div className="grid gap-2">
              <Label htmlFor="file">Audio File</Label>
              <Input id="file" name="file" type="file" accept="audio/*" required />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="title">Title (optional)</Label>
              <Input id="title" name="title" type="text" value={title} onChange={(e) => setTitle(e.target.value)} />
            </div>

            <div className="grid gap-2">
              <Label htmlFor="artist">Artist (optional)</Label>
              <Input id="artist" name="artist" type="text" value={artist} onChange={(e) => setArtist(e.target.value)} />
            </div>

            <div className="flex items-center gap-3">
              <Button type="submit" disabled={isUploading}>
                {isUploading ? "Uploading..." : "Upload"}
              </Button>
              {result?.success && (
                <span className="text-sm text-green-400">
                  Uploaded {formatBytes(result.size)} as ID {result.file_id}
                </span>
              )}
            </div>
          </fetcher.Form>
        </CardContent>
      </Card>
    </div>
  );
}




