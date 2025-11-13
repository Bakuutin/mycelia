"use client"

import React, { useState, useMemo, useCallback, useEffect } from "react"
import { X, Calendar as CalendarIcon, Copy } from "lucide-react"

import { useSettingsStore } from "@/stores/settingsStore"
import { formatTime } from "@/lib/formatTime"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from "@/components/ui/tooltip"

interface NumberInputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  id: string;
  value: number | string;
  onChange: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onFocus: (e: React.FocusEvent<HTMLInputElement>) => void;
  className?: string;
}

function NumberInput({ className, ...props }: NumberInputProps) {
  return (
    <Input
      {...props}
      className={`[&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none ${className || ''}`}
    />
  );
}

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
  const [isoTS, setIsoTS] = useState<number | null>(value ? Math.floor(value.getTime() / 1000) : null)

  // Sync internal state with value prop changes
  useEffect(() => {
    setIsoTS(value ? Math.floor(value.getTime() / 1000) : null);
  }, [value]);

  const [isOpen, setIsOpen] = useState(false)

  const setDate = useCallback((ms: number | null | Date) => {
    if (ms instanceof Date) {
      ms = ms.getTime();
    }
    const newIsoTS = ms ? Math.floor(ms / 1000) : null;
    const newDate = ms ? new Date(ms) : null;
    setIsoTS(newIsoTS);
    onChange(newDate);
  }, [onChange]);

  const selectedDate = useMemo(() => {
    if (isoTS === null) return null;
    return new Date(isoTS * 1000);
  }, [isoTS]);

  const selectedTime = useMemo(() => {
    if (isoTS === null) return { hours: 0, minutes: 0, seconds: 0 };
    if (selectedDate === null) return { hours: 0, minutes: 0, seconds: 0 };
    return {
      hours: selectedDate.getUTCHours(),
      minutes: selectedDate.getUTCMinutes(),
      seconds: selectedDate.getUTCSeconds()
    };
  }, [selectedDate, isoTS]);

  const selectedDateFields = useMemo(() => {
    if (isoTS === null) return { year: 0, month: 0, day: 0 };
    if (selectedDate === null) return { year: new Date().getFullYear(), month: new Date().getMonth() + 1, day: new Date().getDate() };
    return {
      year: selectedDate.getFullYear(),
      month: selectedDate.getMonth() + 1,
      day: selectedDate.getDate()
    };
  }, [selectedDate, isoTS]);


  const replaceTime = (date: Date | null | undefined, time: { hours: number, minutes: number, seconds: number }) => {
    if (!date) return null;
    date.setUTCHours(time.hours);
    date.setUTCMinutes(time.minutes);
    date.setUTCSeconds(time.seconds);
    return date;
  };


  const handleDaySelect = (localDate: Date | undefined) => {
    if (localDate === undefined) {
      return;
    }
    const year = localDate.getFullYear();
    const month = localDate.getMonth();
    const day = localDate.getDate();

    const ts = Date.UTC(year, month, day, selectedTime.hours, selectedTime.minutes, selectedTime.seconds);

    if (isNaN(ts)) {
      return;
    }

      setDate(ts);
    };

  const handleTimeChange = (field: 'hours' | 'minutes' | 'seconds', value: number | string) => {
    // If value is empty string, don't update
    if (value === '') return;
    
    const baseDate = selectedDate || new Date();
    setDate(
      replaceTime(baseDate, { 
        ...selectedTime, 
        [field]: value as number
      })
    );
  };

  const handleDateChange = (field: 'year' | 'month' | 'day', value: number | string) => {
    // If value is empty string, don't update
    if (value === '') return;
    
    // Special handling for year field - check if it looks like a timestamp
    if (field === 'year') {
      const numValue = Number(value);
      // Check if the value looks like a Unix timestamp (not in reasonable year range)
      if (Math.abs(numValue) > 100000) {
        // Treat as timestamp - convert to milliseconds and set directly
        setDate(numValue * 1000);
        return;
      }
    }
    
    const baseDate = selectedDate || new Date();
    const newDate = new Date(baseDate);
    
    if (field === 'year') {
      newDate.setFullYear(value as number);
    } else if (field === 'month') {
      newDate.setMonth((value as number) - 1); // month is 0-indexed
    } else if (field === 'day') {
      newDate.setDate(value as number);
    }
    
    setDate(
      replaceTime(newDate, selectedTime)
    );
  };


  const displayText = useMemo(() => {
    if (selectedDate === null) return null;
    if (isoTS === 0) return "THE BEGINNING OF UNIX TIME!";
    return formatTime(selectedDate, timeFormat);
  }, [isoTS, timeFormat, selectedDate]);

  const handleCopyTimestamp = useCallback(async () => {
    if (isoTS === null) return;
    
    try {
      await navigator.clipboard.writeText(isoTS.toString());
    } catch (error) {
      console.error('Failed to copy timestamp:', error);
    }
  }, [isoTS]);

  return (
    <div className="space-y-2 min-w-[250px]">
      <div className="flex gap-1">
                    <div>
                      <Label htmlFor="year" className="text-xs text-muted-foreground">Year</Label>
                      <NumberInput
                        id="year"
                        type="number"
                        value={selectedDateFields.year === 0 ? '' : selectedDateFields.year}
                        onChange={(e) => handleDateChange('year', e.target.value === '' ? '' : parseInt(e.target.value) || new Date().getFullYear())}
                        onFocus={(e) => e.target.select()}
                        className="h-8 w-[80px]"
                      />
                    </div>
                    <div>
                      <Label htmlFor="month" className="text-xs text-muted-foreground">Month</Label>
                      <NumberInput
                        id="month"
                        type="number"
                        min="1"
                        max="12"
                        value={selectedDateFields.month === 0 ? '' : selectedDateFields.month}
                        onChange={(e) => handleDateChange('month', e.target.value === '' ? '' : parseInt(e.target.value) || 1)}
                        onFocus={(e) => e.target.select()}
                        className="h-8 w-[50px]"
                      />
                    </div>
                    <div>
                      <Label htmlFor="day" className="text-xs text-muted-foreground">Day</Label>
                      <NumberInput
                        id="day"
                        type="number"
                        min="1"
                        max="31"
                        value={selectedDateFields.day === 0 ? '' : selectedDateFields.day}
                        onChange={(e) => handleDateChange('day', e.target.value === '' ? '' : parseInt(e.target.value) || 1)}
                        onFocus={(e) => e.target.select()}
                        className="h-8 w-[50px]"
                      />
                    </div>
                    <div>
                      <Label htmlFor="hours" className="text-xs text-muted-foreground">Hour</Label>
                      <NumberInput
                        id="hours"
                        type="number"
                        min="0"
                        max="23"
                        value={selectedTime.hours === 0 && isoTS === null ? '' : selectedTime.hours}
                        onChange={(e) => handleTimeChange('hours', e.target.value === '' ? '' : parseInt(e.target.value) || 0)}
                        onFocus={(e) => e.target.select()}
                        className="h-8 w-[50px]"
                      />
                    </div>
                    <div>
                      <Label htmlFor="minutes" className="text-xs text-muted-foreground">Min</Label>
                      <NumberInput
                        id="minutes"
                        type="number"
                        min="0"
                        max="59"
                        value={selectedTime.minutes === 0 && isoTS === null ? '' : selectedTime.minutes}
                        onChange={(e) => handleTimeChange('minutes', e.target.value === '' ? '' : parseInt(e.target.value) || 0)}
                        onFocus={(e) => e.target.select()}
                        className="h-8 w-[50px]"
                      />
                    </div>
                    <div>
                      <Label htmlFor="seconds" className="text-xs text-muted-foreground">Sec</Label>
                      <NumberInput
                        id="seconds"
                        type="number"
                        min="0"
                        max="59"
                        value={selectedTime.seconds === 0 && isoTS === null ? '' : selectedTime.seconds}
                        onChange={(e) => handleTimeChange('seconds', e.target.value === '' ? '' : parseInt(e.target.value) || 0)}
                        onFocus={(e) => e.target.select()}
                        className="h-8 w-[50px]"
                      />
                    </div>
         
        <div className="flex flex-col justify-end">
          <Popover open={isOpen} onOpenChange={setIsOpen}>
            <PopoverTrigger asChild>
              <Button
                variant="outline"
                className="h-8 w-8 p-0"
                disabled={disabled}
              >
                <CalendarIcon className="h-4 w-4" />
              </Button>
            </PopoverTrigger>
          <PopoverContent className="w-auto p-0" align="start">
            {isOpen && (
              <div className="p-3">
                <Calendar
                  mode="single"
                  captionLayout="dropdown"
                  selected={selectedDate || undefined}
                  onSelect={handleDaySelect}
                  defaultMonth={selectedDate || new Date()}
                />
              </div>
            )}
          </PopoverContent>
          </Popover>
        </div>
        {isoTS !== null && (
          <div className="flex flex-col justify-end">
            <TooltipProvider>
              <Tooltip>
                <TooltipTrigger asChild>
                  <Button
                    type="button"
                    variant="outline"
                    className="h-8 w-8 p-0"
                    onClick={handleCopyTimestamp}
                  >
                    <Copy className="h-4 w-4" />
                  </Button>
                </TooltipTrigger>
                <TooltipContent>
                  <p>Copy timestamp: {isoTS}</p>
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </div>
        )}
        {nullable && (
          <div className="flex flex-col justify-end">
            <Button
              type="button"
              variant="outline"
              className="h-8 w-8 p-0"
              onClick={() => setDate(null)}
              disabled={false}
            >
              <X className="h-4 w-4" />
            </Button>
          </div>
        )}
       
      </div>
      {isoTS !== null && (
        <div className="text-sm text-muted-foreground">
          {displayText}
        </div>
      )}
    </div>
  )
}
