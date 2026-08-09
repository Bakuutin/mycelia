import { useEffect, useMemo, useState } from "react";
import { toast } from "sonner";
import { MapContainer, Marker, TileLayer, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Loader2, MapPin, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { DateTimePicker } from "@/components/ui/datetime-picker";
import {
  useAssignManualLocation,
  usePlaceSearch,
  useUpdateSegment,
} from "@/hooks/useLocationQueries";
import type { GeonamesCity, LocationSegment } from "@/types/location";
import { formatPlace } from "@/types/location";
import { useSettingsStore } from "@/stores/settingsStore";

const pinIcon = L.divIcon({
  className: "",
  iconSize: [24, 24],
  iconAnchor: [12, 24],
  html:
    '<div style="font-size:24px;line-height:24px;filter:drop-shadow(0 1px 2px rgba(0,0,0,.5));">📍</div>',
});

function PickPoint({
  onPick,
}: {
  onPick: (lat: number, lng: number) => void;
}) {
  useMapEvents({
    click: (e) => onPick(e.latlng.lat, e.latlng.lng),
  });
  return null;
}

interface AssignLocationDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initialStart?: Date;
  initialEnd?: Date;
  /**
   * Edit mode: a manual segment is updated in place; a derived segment gets
   * a manual override for the same range (derived data is clipped around it).
   */
  editSegment?: LocationSegment | null;
}

export function AssignLocationDialog({
  open,
  onOpenChange,
  initialStart,
  initialEnd,
  editSegment,
}: AssignLocationDialogProps) {
  const [start, setStart] = useState<Date | undefined>(initialStart);
  const [end, setEnd] = useState<Date | undefined>(initialEnd);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [selectedCity, setSelectedCity] = useState<GeonamesCity | null>(null);
  const [pickedPoint, setPickedPoint] = useState<
    { lat: number; lng: number } | null
  >(null);
  const [placeTouched, setPlaceTouched] = useState(false);
  const tileUrl = useSettingsStore((state) => state.mapTileUrl);

  const isManualEdit = editSegment?.type === "manual";

  useEffect(() => {
    if (open) {
      if (editSegment) {
        setStart(new Date(editSegment.start));
        setEnd(new Date(editSegment.end));
        if (editSegment.loc) {
          setPickedPoint({
            lat: editSegment.loc.coordinates[1],
            lng: editSegment.loc.coordinates[0],
          });
        } else {
          setPickedPoint(null);
        }
      } else {
        setStart(initialStart);
        setEnd(initialEnd);
        setPickedPoint(null);
      }
      setSearch("");
      setSelectedCity(null);
      setPlaceTouched(false);
    }
  }, [
    open,
    initialStart?.getTime(),
    initialEnd?.getTime(),
    editSegment ? String(editSegment._id) : null,
  ]);

  useEffect(() => {
    const t = setTimeout(() => setDebouncedSearch(search), 250);
    return () => clearTimeout(t);
  }, [search]);

  const { data: cities, isFetching } = usePlaceSearch(debouncedSearch, open);
  const assign = useAssignManualLocation();
  const update = useUpdateSegment();

  const chosen = useMemo(() => {
    if (selectedCity) {
      return {
        label: `${selectedCity.name}, ${selectedCity.country}`,
        lat: selectedCity.loc.coordinates[1],
        lng: selectedCity.loc.coordinates[0],
      };
    }
    if (pickedPoint) {
      return {
        label: !placeTouched && editSegment?.place
          ? formatPlace(editSegment.place)
          : `${pickedPoint.lat.toFixed(4)}, ${pickedPoint.lng.toFixed(4)}`,
        ...pickedPoint,
      };
    }
    return null;
  }, [selectedCity, pickedPoint, placeTouched, editSegment]);

  const isPending = assign.isPending || update.isPending;
  const canSubmit = !!chosen && !!start && !!end &&
    end.getTime() > start.getTime() && !isPending;

  const submit = async () => {
    if (!chosen || !start || !end) return;
    const placeInput = selectedCity
      ? { geonameId: selectedCity.geonameId }
      : { latitude: pickedPoint!.lat, longitude: pickedPoint!.lng };
    try {
      if (isManualEdit) {
        await update.mutateAsync({
          id: String(editSegment!._id),
          start,
          end,
          // Untouched place keeps the stored one (avoid degrading a city
          // name into raw coordinates).
          ...(placeTouched || selectedCity ? { place: placeInput } : {}),
        });
        toast.success(`Location updated. Timezone follows automatically.`);
      } else {
        await assign.mutateAsync({ start, end, place: placeInput });
        toast.success(
          editSegment
            ? `Manual override "${chosen.label}" created — it replaces the imported data for this range.`
            : `Location "${chosen.label}" assigned. The timeline timezone updates automatically.`,
        );
      }
      onOpenChange(false);
    } catch (err) {
      toast.error(
        err instanceof Error ? err.message : "Failed to save location",
      );
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>
            {isManualEdit
              ? "Edit manual location"
              : editSegment
              ? "Override with a manual location"
              : "Set location for a time range"}
          </DialogTitle>
          <DialogDescription>
            {isManualEdit
              ? "Adjust the place or the time range; the paired timezone period follows."
              : editSegment
              ? "The imported data for this range stays in the database but is replaced by your manual assignment."
              : "Tell Mycelia where you were when there is no GPS data. This also sets the timezone for the range."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-3">
          <div className="space-y-1">
            <Label>From</Label>
            <DateTimePicker
              value={start}
              onChange={(d) => setStart(d ?? undefined)}
              placeholder="Start"
            />
          </div>
          <div className="space-y-1">
            <Label>To</Label>
            <DateTimePicker
              value={end}
              onChange={(d) => setEnd(d ?? undefined)}
              placeholder="End"
            />
          </div>
        </div>

        <div className="space-y-1">
          <Label htmlFor="place-search">City or place</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 h-4 w-4 text-muted-foreground" />
            <Input
              id="place-search"
              className="pl-8"
              placeholder="Start typing a city name…"
              value={selectedCity
                ? `${selectedCity.name}, ${selectedCity.country}`
                : search}
              onChange={(e) => {
                setSelectedCity(null);
                setSearch(e.target.value);
              }}
            />
            {isFetching && (
              <Loader2 className="absolute right-2.5 top-2.5 h-4 w-4 animate-spin text-muted-foreground" />
            )}
          </div>
          {!selectedCity && (cities?.length ?? 0) > 0 && (
            <div className="max-h-36 overflow-y-auto rounded-md border text-sm">
              {cities!.map((city) => (
                <button
                  key={city.geonameId}
                  type="button"
                  className="flex w-full items-center gap-2 px-2.5 py-1.5 text-left hover:bg-accent"
                  onClick={() => {
                    setSelectedCity(city);
                    setPickedPoint(null);
                  }}
                >
                  <MapPin className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                  <span className="truncate">
                    {city.name}
                    <span className="text-muted-foreground">
                      , {city.admin1 ? `${city.admin1}, ` : ""}
                      {city.country}
                    </span>
                  </span>
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="space-y-1">
          <Label>…or click the exact spot on the map</Label>
          <div className="isolate h-44 overflow-hidden rounded-md border">
            <MapContainer
              center={chosen ? [chosen.lat, chosen.lng] : [30, 10]}
              zoom={chosen ? 9 : 1}
              className="h-full w-full"
              scrollWheelZoom
            >
              <TileLayer
                url={tileUrl}
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              />
              <PickPoint
                onPick={(lat, lng) => {
                  setPickedPoint({ lat, lng });
                  setSelectedCity(null);
                  setPlaceTouched(true);
                }}
              />
              {chosen && (
                <Marker position={[chosen.lat, chosen.lng]} icon={pinIcon} />
              )}
            </MapContainer>
          </div>
          {chosen && (
            <p className="text-xs text-muted-foreground">
              Selected: {chosen.label}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={!canSubmit}>
            {isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            {isManualEdit ? "Save changes" : "Set location"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
