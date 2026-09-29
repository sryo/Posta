import { formatClock } from "./dateFormat";

// Times of day as the event form keeps them: "HH:MM", 24-hour

export const TIME_STEP_MINUTES = 15;
const LAST_MINUTE = 23 * 60 + 59;

export function timeToMinutes(time: string): number | null {
  const m = time.match(/^(\d{2}):(\d{2})$/);
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
}

export function minutesToTime(minutes: number): string {
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}

// A typed time: "15:30", "1530", "9.30", "15", "3pm", "3:30 p.m.", "11a"
export function parseTimeInput(text: string): string | null {
  const m = text.trim().toLowerCase().match(/^(\d{1,2})(?:[:.h]?(\d{2}))?\s*(?:([ap])\.?\s*m?\.?)?$/);
  if (!m) return null;
  let hours = Number(m[1]);
  const minutes = m[2] === undefined ? 0 : Number(m[2]);
  const meridiem = m[3];
  if (minutes > 59) return null;
  if (meridiem) {
    if (hours < 1 || hours > 12) return null;
    hours = (hours % 12) + (meridiem === "p" ? 12 : 0);
  } else if (hours > 23) {
    return null;
  }
  return minutesToTime(hours * 60 + minutes);
}

// Every step of the day, plus `current` when it falls between steps
export function timeSteps(current?: string): string[] {
  const steps: string[] = [];
  for (let m = 0; m < 24 * 60; m += TIME_STEP_MINUTES) steps.push(minutesToTime(m));
  const mins = current ? timeToMinutes(current) : null;
  if (mins !== null && mins % TIME_STEP_MINUTES !== 0) {
    steps.splice(Math.ceil(mins / TIME_STEP_MINUTES), 0, current!);
  }
  return steps;
}

export function formatTime(time: string, locale?: string): string {
  const mins = timeToMinutes(time);
  if (mins === null) return time;
  return formatClock(new Date(2000, 0, 1, Math.floor(mins / 60), mins % 60), locale);
}

// The next step up or down; a time between steps snaps to the neighbouring one
export function shiftTime(time: string, delta: number): string {
  const mins = timeToMinutes(time);
  if (mins === null) return time;
  const step = TIME_STEP_MINUTES;
  const next = delta > 0 ? Math.floor(mins / step) * step + step : Math.ceil(mins / step) * step - step;
  return minutesToTime(Math.max(0, Math.min(LAST_MINUTE - (LAST_MINUTE % step), next)));
}
