import React from "react";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Layers, Eye, EyeOff, LayoutGrid, LayoutList } from "lucide-react";
import { useTrackVisibilityStore } from "@/stores/trackVisibilityStore";
import { TRACK_REGISTRY } from "@/components/timeline/tracks";
import { OBJECT_CATEGORIES } from "@/types/tracks";

export function TrackVisibilityPanel() {
  const {
    visibleTracks,
    toggleTrack,
    showAll,
    hideAll,
    objectsLayoutMode,
    setObjectsLayoutMode,
    visibleObjectCategories,
    toggleObjectCategory,
  } = useTrackVisibilityStore();

  // Include objects track in the list
  const allTracks = [
    ...TRACK_REGISTRY,
    {
      config: {
        id: "objects" as const,
        label: "Objects",
        description: "Timeline objects and events",
        defaultVisible: true,
        defaultHeight: 120,
        color: "#6b7280",
      },
    },
  ];

  const showObjectsOptions = visibleTracks.includes("objects");

  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button variant="outline" size="icon" title="Track visibility">
          <Layers className="h-4 w-4" />
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-72" align="end">
        <div className="space-y-4">
          <div className="flex items-center justify-between">
            <h4 className="font-medium text-sm">Visible Tracks</h4>
            <div className="flex gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={showAll}
                className="h-7 px-2"
              >
                <Eye className="h-3 w-3 mr-1" />
                All
              </Button>
              <Button
                variant="ghost"
                size="sm"
                onClick={hideAll}
                className="h-7 px-2"
              >
                <EyeOff className="h-3 w-3 mr-1" />
                None
              </Button>
            </div>
          </div>
          <div className="space-y-3">
            {allTracks.map((track) => (
              <div
                key={track.config.id}
                className="flex items-center justify-between"
              >
                <Label htmlFor={track.config.id} className="text-sm cursor-pointer">
                  <span
                    className="inline-block w-2 h-2 rounded-full mr-2"
                    style={{ backgroundColor: track.config.color }}
                  />
                  {track.config.label}
                </Label>
                <Switch
                  id={track.config.id}
                  checked={visibleTracks.includes(track.config.id)}
                  onCheckedChange={() => toggleTrack(track.config.id)}
                />
              </div>
            ))}
          </div>

          {/* Objects Layout Options */}
          {showObjectsOptions && (
            <>
              <div className="border-t pt-3">
                <div className="flex items-center justify-between mb-3">
                  <h4 className="font-medium text-sm">Objects Layout</h4>
                  <div className="flex gap-1">
                    <Button
                      variant={objectsLayoutMode === "mixed" ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setObjectsLayoutMode("mixed")}
                      className="h-7 px-2"
                      title="Mixed layout"
                    >
                      <LayoutList className="h-3 w-3" />
                    </Button>
                    <Button
                      variant={objectsLayoutMode === "by-category" ? "secondary" : "ghost"}
                      size="sm"
                      onClick={() => setObjectsLayoutMode("by-category")}
                      className="h-7 px-2"
                      title="Group by category"
                    >
                      <LayoutGrid className="h-3 w-3" />
                    </Button>
                  </div>
                </div>

                {/* Category toggles (only visible when by-category mode) */}
                {objectsLayoutMode === "by-category" && (
                  <div className="space-y-2 pl-2">
                    <Label className="text-xs text-muted-foreground">Categories</Label>
                    {OBJECT_CATEGORIES.map((category) => (
                      <div
                        key={category.id}
                        className="flex items-center justify-between"
                      >
                        <Label htmlFor={`cat-${category.id}`} className="text-xs cursor-pointer flex items-center gap-1.5">
                          <span>{category.icon}</span>
                          <span
                            className="inline-block w-2 h-2 rounded-full"
                            style={{ backgroundColor: category.color }}
                          />
                          {category.label}
                        </Label>
                        <Switch
                          id={`cat-${category.id}`}
                          checked={visibleObjectCategories.includes(category.id)}
                          onCheckedChange={() => toggleObjectCategory(category.id)}
                          className="scale-75"
                        />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
