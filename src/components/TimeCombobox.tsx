import { createEffect, createSignal, createUniqueId, For, onCleanup, onMount, Show } from "solid-js";
import { formatTime, parseTimeInput, shiftTime, timeSteps } from "../app/timeInput";
import { isImeComposing } from "../shared/keyboard";

// A time field that takes a typed time ("3pm", "15:30") or one picked from
// the day in 15-minute steps
export const TimeCombobox = (props: {
  label: string;
  value: string;
  onChange: (time: string) => void;
  class?: string;
  locale?: string;
  autofocus?: boolean;
}) => {
  const listId = createUniqueId();
  const [open, setOpen] = createSignal(false);
  const [text, setText] = createSignal("");
  let input: HTMLInputElement | undefined;
  let list: HTMLDivElement | undefined;

  onMount(() => {
    if (!props.autofocus) return;
    const timer = setTimeout(() => input?.focus(), 0);
    onCleanup(() => clearTimeout(timer));
  });

  const shown = () => formatTime(props.value, props.locale);
  createEffect(() => setText(shown()));

  createEffect(() => {
    if (!open()) return;
    props.value;
    list?.querySelector<HTMLElement>('[aria-selected="true"]')?.scrollIntoView({ block: "center" });
  });

  const pick = (time: string) => {
    if (time !== props.value) props.onChange(time);
    setText(formatTime(time, props.locale));
  };

  // What was typed becomes the time, or the field shows the time again
  const commit = () => {
    if (text() === shown()) return;
    const time = parseTimeInput(text());
    if (time) pick(time);
    else setText(shown());
  };

  const handleKeyDown = (e: KeyboardEvent) => {
    if (isImeComposing(e)) return;
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      commit();
      pick(shiftTime(props.value, e.key === "ArrowDown" ? 1 : -1));
      setOpen(true);
      return;
    }
    if (e.key === "Enter") {
      commit();
      if (e.metaKey || e.ctrlKey) return;
      e.preventDefault();
      setOpen(false);
      return;
    }
    if (e.key === "Escape" && open()) {
      e.stopPropagation();
      setText(shown());
      setOpen(false);
    }
  };

  return (
    <div class={`time-combobox ${props.class ?? ""}`}>
      <input
        ref={input}
        type="text"
        class="time-combobox-input"
        role="combobox"
        aria-label={props.label}
        aria-expanded={open()}
        aria-controls={listId}
        aria-autocomplete="none"
        inputMode="text"
        autocomplete="off"
        value={text()}
        onInput={(e) => setText(e.currentTarget.value)}
        onFocus={() => { setOpen(true); input?.select(); }}
        onClick={() => setOpen(true)}
        onBlur={() => { commit(); setOpen(false); }}
        onKeyDown={handleKeyDown}
      />
      <Show when={open()}>
        <div ref={list} id={listId} class="time-combobox-list" role="listbox" aria-label={props.label}>
          <For each={timeSteps(props.value)}>
            {(time) => (
              <div
                class="time-combobox-option"
                classList={{ selected: time === props.value }}
                role="option"
                aria-selected={time === props.value}
                // mousedown, not click: the input's blur would close the list first
                onMouseDown={(e) => { e.preventDefault(); pick(time); setOpen(false); }}
              >
                {formatTime(time, props.locale)}
              </div>
            )}
          </For>
        </div>
      </Show>
    </div>
  );
};
