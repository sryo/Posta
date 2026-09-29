import { createSignal, For, Show } from "solid-js";
import { extractEmail, extractName, splitEmailList } from "../utils";

const SHOWN_WHEN_FOLDED = 2;

// A message's To and Cc: "to Ana, Jules +2", opening to the full addresses
export const MessageRecipients = (props: { to?: string; cc?: string; currentUserEmail?: string }) => {
  const [open, setOpen] = createSignal(false);
  const list = (header: string | undefined) => splitEmailList(header ?? "").map(a => a.trim()).filter(Boolean);
  const to = () => list(props.to);
  const cc = () => list(props.cc);

  const shortName = (address: string) => {
    if (extractEmail(address).toLowerCase() === props.currentUserEmail?.toLowerCase()) return "me";
    const name = extractName(address);
    if (!name) return extractEmail(address);
    // "Last, First" display names put the given name second
    const given = name.includes(",") ? name.split(",")[1] : name;
    return given.trim().split(/\s+/)[0];
  };

  const summary = () => {
    const all = [...to(), ...cc()];
    const shown = all.slice(0, SHOWN_WHEN_FOLDED).map(shortName).join(", ");
    const rest = all.length - SHOWN_WHEN_FOLDED;
    return `to ${shown}${rest > 0 ? ` +${rest}` : ""}`;
  };

  return (
    <Show when={to().length + cc().length > 0}>
      <div>
        <button class="message-recipients-toggle" aria-expanded={open()} onClick={() => setOpen(!open())}>
          {summary()}
        </button>
        <Show when={open()}>
          <dl class="message-recipients-list">
            <For each={[{ label: "To", addresses: to() }, { label: "Cc", addresses: cc() }].filter(r => r.addresses.length > 0)}>
              {(row) => (
                <>
                  <dt>{row.label}</dt>
                  <dd>
                    <For each={row.addresses}>
                      {(address) => {
                        const name = extractName(address);
                        return (
                          <span class="message-recipient">
                            <span class="message-recipient-name">{name ?? extractEmail(address)}</span>
                            <Show when={name}>
                              {" "}<span class="message-recipient-address">{extractEmail(address)}</span>
                            </Show>
                          </span>
                        );
                      }}
                    </For>
                  </dd>
                </>
              )}
            </For>
          </dl>
        </Show>
      </div>
    </Show>
  );
};
