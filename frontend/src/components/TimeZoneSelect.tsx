import { type MouseEvent, useMemo, useState } from "react";
import { Check, ChevronsUpDown, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { cn } from "@/lib/utils";
import {
  BROWSER_TIME_ZONE,
  getBrowserTimeZone,
  getTimeZoneSearchOptions,
  type TimeZoneSearchOption,
} from "@/lib/timeZones";
import { useSettingsStore } from "@/stores/settingsStore";

interface TimeZoneSelectProps {
  id?: string;
  value: string;
  onChange: (value: string) => void;
  onPlaceSelect?: (place: string) => void;
  includeBrowser?: boolean;
  className?: string;
  disabled?: boolean;
}

function optionLabel(option: TimeZoneSearchOption) {
  return option.timeZone === "UTC"
    ? "UTC"
    : `${option.city} · ${option.timeZone}`;
}

function matchedPlace(option: TimeZoneSearchOption, search: string) {
  const normalized = search.trim().toLocaleLowerCase();
  if (!normalized) return option.city;
  return [option.city, ...option.aliases].find((place) =>
    place.toLocaleLowerCase().includes(normalized)
  ) ?? option.city;
}

export function TimeZoneSelect({
  id,
  value,
  onChange,
  onPlaceSelect,
  includeBrowser = false,
  className = "",
  disabled = false,
}: TimeZoneSelectProps) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const options = useMemo(getTimeZoneSearchOptions, []);
  const browserTimeZone = getBrowserTimeZone();
  const favoriteTimeZones = useSettingsStore((state) =>
    state.favoriteTimeZones
  );
  const toggleFavoriteTimeZone = useSettingsStore((state) =>
    state.toggleFavoriteTimeZone
  );
  const selected = options.find((option) => option.timeZone === value);
  const favorites = favoriteTimeZones.flatMap((timeZone) => {
    const option = options.find((item) => item.timeZone === timeZone);
    return option ? [option] : [];
  });

  const selectOption = (option: TimeZoneSearchOption) => {
    onChange(option.timeZone);
    onPlaceSelect?.(matchedPlace(option, search));
    setOpen(false);
    setSearch("");
  };

  const toggleFavorite = (
    event: MouseEvent<HTMLButtonElement>,
    timeZone: string,
  ) => {
    event.preventDefault();
    event.stopPropagation();
    toggleFavoriteTimeZone(timeZone);
  };

  const renderOption = (
    option: TimeZoneSearchOption,
    section: "favorite" | "all",
  ) => {
    const isFavorite = favoriteTimeZones.includes(option.timeZone);
    return (
      <CommandItem
        key={`${section}:${option.timeZone}`}
        value={`${section} ${option.searchValue}`}
        onSelect={() => selectOption(option)}
        className="group"
      >
        <Check
          className={cn(
            "mr-1 h-4 w-4",
            value === option.timeZone ? "opacity-100" : "opacity-0",
          )}
        />
        <span className="min-w-0 flex-1">
          <span className="block truncate">{optionLabel(option)}</span>
          {option.aliases.length > 0 && (
            <span className="block truncate text-xs text-muted-foreground">
              Also: {option.aliases.join(", ")}
            </span>
          )}
        </span>
        <button
          type="button"
          aria-label={`${isFavorite ? "Remove" : "Add"} ${option.city} ${
            isFavorite ? "from" : "to"
          } favorites`}
          title={isFavorite ? "Remove from favorites" : "Add to favorites"}
          className="rounded p-1 text-muted-foreground hover:bg-muted hover:text-foreground"
          onMouseDown={(event) => {
            event.preventDefault();
            event.stopPropagation();
          }}
          onClick={(event) => toggleFavorite(event, option.timeZone)}
        >
          <Star className={cn("h-4 w-4", isFavorite && "fill-current")} />
        </button>
      </CommandItem>
    );
  };

  const displayLabel = value === BROWSER_TIME_ZONE
    ? `Current device (${browserTimeZone})`
    : selected
    ? optionLabel(selected)
    : value;

  return (
    <Popover
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        if (!nextOpen) setSearch("");
      }}
    >
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          role="combobox"
          aria-expanded={open}
          disabled={disabled}
          className={cn("w-full justify-between font-normal", className)}
        >
          <span className="truncate">{displayLabel}</span>
          <ChevronsUpDown className="ml-2 h-4 w-4 shrink-0 opacity-50" />
        </Button>
      </PopoverTrigger>
      <PopoverContent align="start" className="w-[380px] p-0">
        <Command>
          <CommandInput
            value={search}
            onValueChange={setSearch}
            placeholder="Search city or time zone…"
          />
          <CommandList>
            <CommandEmpty>No city or time zone found.</CommandEmpty>
            {includeBrowser && (
              <CommandGroup heading="Device">
                <CommandItem
                  value={`device current ${browserTimeZone}`}
                  onSelect={() => {
                    onChange(BROWSER_TIME_ZONE);
                    setOpen(false);
                    setSearch("");
                  }}
                >
                  <Check
                    className={cn(
                      "mr-1 h-4 w-4",
                      value === BROWSER_TIME_ZONE ? "opacity-100" : "opacity-0",
                    )}
                  />
                  Current device · {browserTimeZone}
                </CommandItem>
              </CommandGroup>
            )}
            {favorites.length > 0 && (
              <>
                <CommandGroup heading="Favorites">
                  {favorites.map((option) => renderOption(option, "favorite"))}
                </CommandGroup>
                <CommandSeparator />
              </>
            )}
            <CommandGroup heading="All cities and time zones">
              {options.map((option) => renderOption(option, "all"))}
            </CommandGroup>
          </CommandList>
        </Command>
      </PopoverContent>
    </Popover>
  );
}
