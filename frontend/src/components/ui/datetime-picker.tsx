"use client"

import { useState, useMemo, useCallback } from "react"
import { X, Calendar as CalendarIcon } from "lucide-react"

import { useSettingsStore } from "@/stores/settingsStore"
import { formatTime } from "@/lib/formatTime"
import { Button } from "@/components/ui/button"
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover"
import { Calendar } from "@/components/ui/calendar"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"

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

  const [isOpen, setIsOpen] = useState(false)

  const setDate = useCallback((ms: number | null | Date)  => {
    if (ms instanceof Date) {
      ms = ms.getTime();
    }
      setIsoTS(ms ? Math.floor(ms / 1000) : null);
      onChange(ms ? new Date(ms) : null);
    },
    [onChange]
  );

  const selectedDate = useMemo(() => {
    if (isoTS === null) return null;
    return new Date(isoTS * 1000);
  }, [isoTS]);

  const selectedTime = useMemo(() => {
    if (selectedDate === null) return { hours: 0, minutes: 0, seconds: 0 };
    return {
      hours: selectedDate.getUTCHours(),
      minutes: selectedDate.getUTCMinutes(),
      seconds: selectedDate.getUTCSeconds()
    };
  }, [selectedDate]);

  const selectedDateFields = useMemo(() => {
    if (selectedDate === null) return { year: new Date().getFullYear(), month: new Date().getMonth() + 1, day: new Date().getDate() };
    return {
      year: selectedDate.getFullYear(),
      month: selectedDate.getMonth() + 1,
      day: selectedDate.getDate()
    };
  }, [selectedDate]);


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

  const handleTimeChange = (field: 'hours' | 'minutes' | 'seconds', value: number) => {
    const baseDate = selectedDate || new Date();
    setDate(
      replaceTime(baseDate, { 
        ...selectedTime, 
        [field]: value 
      })
    );
  };

  const handleDateChange = (field: 'year' | 'month' | 'day', value: number) => {
    const baseDate = selectedDate || new Date();
    const newDate = new Date(baseDate);
    
    if (field === 'year') {
      newDate.setFullYear(value);
    } else if (field === 'month') {
      newDate.setMonth(value - 1); // month is 0-indexed
    } else if (field === 'day') {
      newDate.setDate(value);
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

  return (
    <div className="space-y-2">
      <div className="flex gap-1">
                    <div>
                      <Label htmlFor="year" className="text-xs text-muted-foreground">Year</Label>
                      <Input
                        id="year"
                        type="number"
                        value={selectedDateFields.year}
                        onChange={(e) => handleDateChange('year', parseInt(e.target.value) || new Date().getFullYear())}
                        onFocus={(e) => e.target.select()}
                        className="h-8 w-[80px]"
                      />
                    </div>
                    <div>
                      <Label htmlFor="month" className="text-xs text-muted-foreground">Month</Label>
                      <Input
                        id="month"
                        type="number"
                        min="1"
                        max="12"
                        value={selectedDateFields.month}
                        onChange={(e) => handleDateChange('month', parseInt(e.target.value) || 1)}
                        onFocus={(e) => e.target.select()}
                        className="h-8"
                      />
                    </div>
                    <div>
                      <Label htmlFor="day" className="text-xs text-muted-foreground">Day</Label>
                      <Input
                        id="day"
                        type="number"
                        min="1"
                        max="31"
                        value={selectedDateFields.day}
                        onChange={(e) => handleDateChange('day', parseInt(e.target.value) || 1)}
                        onFocus={(e) => e.target.select()}
                        className="h-8"
                      />
                    </div>
                    <div>
                      <Label htmlFor="hours" className="text-xs text-muted-foreground">Hours</Label>
                      <Input
                        id="hours"
                        type="number"
                        min="0"
                        max="23"
                        value={selectedTime.hours}
                        onChange={(e) => handleTimeChange('hours', parseInt(e.target.value) || 0)}
                        onFocus={(e) => e.target.select()}
                        className="h-8"
                      />
                    </div>
                    <div>
                      <Label htmlFor="minutes" className="text-xs text-muted-foreground">Minutes</Label>
                      <Input
                        id="minutes"
                        type="number"
                        min="0"
                        max="59"
                        value={selectedTime.minutes}
                        onChange={(e) => handleTimeChange('minutes', parseInt(e.target.value) || 0)}
                        onFocus={(e) => e.target.select()}
                        className="h-8"
                      />
                    </div>
                    <div>
                      <Label htmlFor="seconds" className="text-xs text-muted-foreground">Seconds</Label>
                      <Input
                        id="seconds"
                        type="number"
                        min="0"
                        max="59"
                        value={selectedTime.seconds}
                        onChange={(e) => handleTimeChange('seconds', parseInt(e.target.value) || 0)}
                        onFocus={(e) => e.target.select()}
                        className="h-8"
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
