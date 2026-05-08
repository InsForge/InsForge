import React, { useEffect, useRef, useState } from 'react';
import { Calendar, ChevronLeft, ChevronRight, Clock } from 'lucide-react';
import { cn } from '#lib/utils/utils';
import { format, parse } from 'date-fns';
import { Button } from '@insforge/ui';
import { Popover, PopoverContent, PopoverTrigger } from '#components';
import type { DateCellEditorProps } from './types';
import { ColumnType } from '@insforge/shared-schemas';

type PickerMode = 'day' | 'month' | 'year';

interface TimeColumnProps {
  label: string;
  value: number;
  range: number;
  onChange: (value: number) => void;
  scrollRef: React.RefObject<HTMLDivElement | null>;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

// Reusable time column component
function TimeColumn({ label, value, range, onChange, scrollRef }: TimeColumnProps) {
  return (
    <div className="flex-1">
      <div className="mb-1 text-center text-xs text-muted-foreground">{label}</div>
      <div
        ref={scrollRef}
        className="h-60 overflow-y-auto rounded border border-[var(--alpha-8)] bg-semantic-0 p-1"
      >
        {Array.from({ length: range }, (_, i) => (
          <Button
            key={i}
            type="button"
            variant={value === i ? 'primary' : 'ghost'}
            size="sm"
            onClick={() => onChange(i)}
            className={cn(
              'h-7 w-full justify-center rounded',
              value !== i &&
                'text-foreground before:hidden hover:bg-[var(--alpha-8)] hover:text-foreground'
            )}
          >
            {i.toString().padStart(2, '0')}
          </Button>
        ))}
      </div>
    </div>
  );
}

export function DateCellEditor({
  value,
  type = ColumnType.DATETIME,
  nullable,
  onValueChange,
  onCancel,
  className,
}: DateCellEditorProps) {
  const [open, setOpen] = useState(true);
  const [pickerMode, setPickerMode] = useState<PickerMode>('day');
  const [selectedDate, setSelectedDate] = useState<Date>(() => {
    if (value && value !== 'null') {
      if (type === ColumnType.DATE) {
        return parse(value, 'yyyy-MM-dd', new Date());
      } else {
        return new Date(value);
      }
    }
    return new Date();
  });

  const [selectedHour, setSelectedHour] = useState(() => {
    if (value && value !== 'null' && type === ColumnType.DATETIME) {
      return new Date(value).getHours();
    }
    return new Date().getHours();
  });

  const [selectedMinute, setSelectedMinute] = useState(() => {
    if (value && value !== 'null' && type === ColumnType.DATETIME) {
      return new Date(value).getMinutes();
    }
    return new Date().getMinutes();
  });

  const [displayMonth, setDisplayMonth] = useState(selectedDate.getMonth());
  const [displayYear, setDisplayYear] = useState(selectedDate.getFullYear());

  const hourScrollRef = useRef<HTMLDivElement>(null);
  const minuteScrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setOpen(true);
  }, []);

  useEffect(() => {
    // Auto-scroll to selected time values when popover opens
    if (open && type === ColumnType.DATETIME) {
      setTimeout(() => {
        if (hourScrollRef.current) {
          const hourButton = hourScrollRef.current.querySelector(
            `button:nth-child(${selectedHour + 1})`
          );
          if (hourButton) {
            hourButton.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        }
        if (minuteScrollRef.current) {
          const minuteButton = minuteScrollRef.current.querySelector(
            `button:nth-child(${selectedMinute + 1})`
          );
          if (minuteButton) {
            minuteButton.scrollIntoView({ block: 'center', behavior: 'smooth' });
          }
        }
      }, 100);
    }
  }, [open, selectedHour, selectedMinute, type]);

  const handleOpenChange = (isOpen: boolean) => {
    if (!isOpen) {
      onCancel();
    }
    setOpen(isOpen);
  };

  const getDaysInMonth = (year: number, month: number) => {
    return new Date(year, month + 1, 0).getDate();
  };

  const getFirstDayOfMonth = (year: number, month: number) => {
    return new Date(year, month, 1).getDay();
  };

  const handleDateClick = (day: number) => {
    const newDate = new Date(displayYear, displayMonth, day);
    setSelectedDate(newDate);

    if (type === ColumnType.DATE) {
      const dateString = format(newDate, 'yyyy-MM-dd');
      onValueChange(dateString);
      setOpen(false);
    }
  };

  const handleMonthClick = (month: number) => {
    setDisplayMonth(month);
    setPickerMode('day');
  };

  const handleYearClick = (year: number) => {
    setDisplayYear(year);
    setPickerMode('month');
  };

  const handlePrevMonth = () => {
    if (displayMonth === 0) {
      setDisplayMonth(11);
      setDisplayYear(displayYear - 1);
    } else {
      setDisplayMonth(displayMonth - 1);
    }
  };

  const handleNextMonth = () => {
    if (displayMonth === 11) {
      setDisplayMonth(0);
      setDisplayYear(displayYear + 1);
    } else {
      setDisplayMonth(displayMonth + 1);
    }
  };

  const handlePrevYear = () => {
    setDisplayYear(displayYear - 1);
  };

  const handleNextYear = () => {
    setDisplayYear(displayYear + 1);
  };

  const handlePrevDecade = () => {
    setDisplayYear(displayYear - 10);
  };

  const handleNextDecade = () => {
    setDisplayYear(displayYear + 10);
  };

  const handleSave = () => {
    if (type === ColumnType.DATETIME) {
      const dateTime = new Date(selectedDate);
      dateTime.setHours(selectedHour, selectedMinute, 0, 0);
      // Format as local ISO string with timezone offset
      const year = dateTime.getFullYear();
      const month = String(dateTime.getMonth() + 1).padStart(2, '0');
      const day = String(dateTime.getDate()).padStart(2, '0');
      const hours = String(selectedHour).padStart(2, '0');
      const minutes = String(selectedMinute).padStart(2, '0');

      // Get timezone offset in format +/-HH:MM
      const offset = dateTime.getTimezoneOffset();
      const absOffset = Math.abs(offset);
      const offsetHours = String(Math.floor(absOffset / 60)).padStart(2, '0');
      const offsetMinutes = String(absOffset % 60).padStart(2, '0');
      const offsetSign = offset <= 0 ? '+' : '-';
      const timezoneOffset = `${offsetSign}${offsetHours}:${offsetMinutes}`;

      const localISOString = `${year}-${month}-${day}T${hours}:${minutes}:00${timezoneOffset}`;
      onValueChange(localISOString);
    } else {
      const dateString = format(selectedDate, 'yyyy-MM-dd');
      onValueChange(dateString);
    }
    setOpen(false);
  };

  const handleClear = () => {
    if (nullable) {
      onValueChange(null);
      setOpen(false);
    }
  };

  const formatDisplayValue = () => {
    if (!value || value === 'null') {
      return 'Select date...';
    }

    if (type === ColumnType.DATETIME) {
      const d = new Date(value);
      return format(d, 'MMM dd, yyyy hh:mm a');
    } else {
      const date = parse(value, 'yyyy-MM-dd', new Date());
      return format(date, 'MMM dd, yyyy');
    }
  };

  const renderDayPicker = () => {
    const daysInMonth = getDaysInMonth(displayYear, displayMonth);
    const firstDay = getFirstDayOfMonth(displayYear, displayMonth);
    const days = [];

    // Empty cells for days before month starts
    for (let i = 0; i < firstDay; i++) {
      days.push(<div key={`empty-${i}`} className="h-8 w-8" />);
    }

    // Days of the month
    for (let day = 1; day <= daysInMonth; day++) {
      const isSelected =
        selectedDate.getDate() === day &&
        selectedDate.getMonth() === displayMonth &&
        selectedDate.getFullYear() === displayYear;
      const isToday =
        new Date().getDate() === day &&
        new Date().getMonth() === displayMonth &&
        new Date().getFullYear() === displayYear;

      days.push(
        <button
          key={day}
          onClick={() => handleDateClick(day)}
          className={cn(
            'h-8 w-8 rounded text-sm text-foreground hover:bg-[var(--alpha-8)]',
            isSelected && 'bg-primary text-[rgb(var(--inverse))] hover:bg-primary',
            isToday && !isSelected && 'font-bold'
          )}
        >
          {day}
        </button>
      );
    }

    return days;
  };

  const renderMonthPicker = () => {
    return MONTHS.map((month, index) => {
      const isSelected = selectedDate.getMonth() === index;
      return (
        <button
          key={month}
          onClick={() => handleMonthClick(index)}
          className={cn(
            'h-12 w-20 rounded text-sm text-foreground hover:bg-[var(--alpha-8)]',
            isSelected && 'bg-primary text-[rgb(var(--inverse))] hover:bg-primary'
          )}
        >
          {month}
        </button>
      );
    });
  };

  const renderYearPicker = () => {
    const startYear = Math.floor(displayYear / 10) * 10;
    const years = [];

    for (let i = 0; i < 12; i++) {
      const year = startYear + i;
      const isSelected = selectedDate.getFullYear() === year;
      years.push(
        <button
          key={year}
          onClick={() => handleYearClick(year)}
          className={cn(
            'h-12 w-20 rounded text-sm text-foreground hover:bg-[var(--alpha-8)]',
            isSelected && 'bg-primary text-[rgb(var(--inverse))] hover:bg-primary'
          )}
        >
          {year}
        </button>
      );
    }

    return years;
  };

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <Button
          variant="ghost"
          className={cn(
            'h-full w-full justify-start border-0 p-0 text-left text-sm font-normal text-foreground hover:bg-transparent',
            (!value || value === 'null') && 'text-muted-foreground',
            className
          )}
        >
          {type === ColumnType.DATETIME ? (
            <Clock className="mr-2 h-4 w-4" />
          ) : (
            <Calendar className="mr-2 h-4 w-4" />
          )}
          {formatDisplayValue()}
        </Button>
      </PopoverTrigger>
      <PopoverContent
        className="w-auto overflow-hidden border-[var(--alpha-12)] bg-card p-0 shadow-xl"
        align="start"
        side="bottom"
      >
        <div className="flex">
          <div className="p-3">
            {/* Header */}
            <div className="mb-3 flex items-center justify-between">
              <Button
                variant="ghost"
                size="icon-sm"
                onClick={
                  pickerMode === 'day'
                    ? handlePrevMonth
                    : pickerMode === 'month'
                      ? handlePrevYear
                      : handlePrevDecade
                }
              >
                <ChevronLeft className="h-4 w-4" />
              </Button>

              <button
                className="rounded px-2 py-1 text-sm font-medium text-foreground hover:bg-[var(--alpha-8)]"
                onClick={() => {
                  if (pickerMode === 'day') {
                    setPickerMode('month');
                  } else if (pickerMode === 'month') {
                    setPickerMode('year');
                  }
                }}
              >
                {pickerMode === 'day' && `${MONTHS[displayMonth]} ${displayYear}`}
                {pickerMode === 'month' && displayYear}
                {pickerMode === 'year' &&
                  `${Math.floor(displayYear / 10) * 10}-${Math.floor(displayYear / 10) * 10 + 9}`}
              </button>

              <Button
                variant="ghost"
                size="icon-sm"
                onClick={
                  pickerMode === 'day'
                    ? handleNextMonth
                    : pickerMode === 'month'
                      ? handleNextYear
                      : handleNextDecade
                }
              >
                <ChevronRight className="h-4 w-4" />
              </Button>
            </div>

            {/* Calendar Grid - Fixed dimensions */}
            <div className="h-60 w-70">
              {pickerMode === 'day' && (
                <>
                  {/* Weekday headers */}
                  <div className="mb-1 grid grid-cols-7 gap-1">
                    {WEEKDAYS.map((day) => (
                      <div
                        key={day}
                        className="flex h-8 w-8 items-center justify-center text-xs text-muted-foreground"
                      >
                        {day}
                      </div>
                    ))}
                  </div>

                  {/* Days */}
                  <div className="grid grid-cols-7 gap-1">{renderDayPicker()}</div>
                </>
              )}

              {pickerMode === 'month' && (
                <div className="grid grid-cols-3 gap-2 pt-4">{renderMonthPicker()}</div>
              )}

              {pickerMode === 'year' && (
                <div className="grid grid-cols-3 gap-2 pt-4">{renderYearPicker()}</div>
              )}
            </div>
          </div>

          {type === ColumnType.DATETIME && (
            <div className="w-35 border-l border-[var(--alpha-8)] bg-[var(--alpha-4)]">
              <div className="p-3">
                <div className="mb-3 flex items-center justify-center gap-2">
                  <Clock className="h-4 w-4 text-muted-foreground" />
                  <span className="text-sm font-medium text-foreground">Time</span>
                </div>

                <div className="flex gap-2">
                  <TimeColumn
                    label="Hour"
                    value={selectedHour}
                    range={24}
                    onChange={setSelectedHour}
                    scrollRef={hourScrollRef}
                  />
                  <TimeColumn
                    label="Min"
                    value={selectedMinute}
                    range={60}
                    onChange={setSelectedMinute}
                    scrollRef={minuteScrollRef}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Action buttons */}
        <div className="flex items-center gap-2 border-t border-[var(--alpha-8)] bg-[var(--alpha-4)] p-3">
          {nullable && (
            <Button variant="outline" size="sm" onClick={handleClear} className="flex-1">
              Null
            </Button>
          )}
          <Button
            variant="outline"
            size="sm"
            onClick={() => {
              onCancel();
              setOpen(false);
            }}
            className="flex-1"
          >
            Cancel
          </Button>
          <Button size="sm" onClick={handleSave} className="flex-1">
            Save
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
}
