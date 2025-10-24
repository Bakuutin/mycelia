"use client"

import { useState, useEffect, useRef } from "react"
import { format } from "date-fns"
import { X } from "lucide-react"

import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/stores/settingsStore"
import { formatTime } from "@/lib/formatTime"
import { Button } from "@/components/ui/button"

interface DateTimePickerProps {
  value?: Date;
  onChange: (value: Date | null) => void;
  placeholder?: string;
  disabled?: boolean;
  nullable?: boolean;
}

export function DateTimePicker({ 
  value, 
  onChange, 
  placeholder = "Pick a date and time", 
  disabled,
  nullable = false
}: DateTimePickerProps) {
  const { timeFormat } = useSettingsStore();
  const [isoTS, setIsoTS] = useState<number | null>(value ? value.getTime() : null)

  const handleClear = () => {
    setIsoTS(null);
    onChange(null);
  };

  return (
    <div className="relative">
      <input
        type="number"
        value={isoTS ?? ""}
        onChange={(e) => {
          if (isNaN(Number(e.target.value))) {
            return
          }
          setIsoTS(Number(e.target.value))
          onChange(new Date(Number(e.target.value)))
        }}
        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm pr-8"
        disabled={disabled}
        placeholder={placeholder}
      />
      {nullable && isoTS && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 p-0 hover:bg-gray-100"
          onClick={handleClear}
          disabled={disabled}
        >
          <X className="h-3 w-3" />
        </Button>
      )}
      {isoTS && (
        <span className="text-sm text-gray-500">
          {formatTime(new Date(isoTS), timeFormat)}
        </span>
      )}
    </div>
  )
}
