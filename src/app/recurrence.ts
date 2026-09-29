// Which occurrences of a repeating event a save or delete applies to
export type RecurrenceScope = "this" | "following" | "all";

type Occurrence = { id: string; start_time: number; recurring_event_id?: string | null };

// Whether deleting `deleted` with `scope` also removes `event`
export function deletedByScope(event: Occurrence, deleted: Occurrence, scope: RecurrenceScope): boolean {
  if (event.id === deleted.id) return true;
  const series = deleted.recurring_event_id;
  if (scope === "this" || !series || event.recurring_event_id !== series) return false;
  return scope === "all" || event.start_time >= deleted.start_time;
}
