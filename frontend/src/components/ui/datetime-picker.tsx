"use client"

import { useState, useEffect, useRef } from "react"
import { format } from "date-fns"

import { cn } from "@/lib/utils"
import { useSettingsStore } from "@/stores/settingsStore"
import { formatTime } from "@/lib/formatTime"

interface DateTimePickerProps {
  value?: Date;
  onChange: (value: Date) => void;
  placeholder?: string;
  disabled?: boolean;
}

export function DateTimePicker({ 
  value, 
  onChange, 
  placeholder = "Pick a date and time", 
  disabled
}: DateTimePickerProps) {
  value
  const [isoTS, setIsoTS] = useState<number | null>(value ? value.getTime() / 1000 : null)
  return (
    <div>
      <input
        type="number"
        value={isoTS ?? ""}
        onChange={(e) => {
          if (isNaN(Number(e.target.value))) {
            return
          }
          setIsoTS(Number(e.target.value))
          onChange(new Date(Number(e.target.value) * 1000))
        }}
        className="flex h-9 w-full rounded-md border border-input bg-background px-3 py-1 text-sm"
        disabled={disabled}
      />
    </div>
  )
}
