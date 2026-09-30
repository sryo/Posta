import { KeyHint } from "./KeyHint";
import { Segmented } from "./Segmented";
import { RSVP_ANSWERS, type RsvpStatus } from "../app/rsvp";

// The user's answer to an invite, shared by invite rows, the opened invite
// email and the event view
export const RsvpControl = (props: {
  value: string | null | undefined;
  onAnswer: (status: RsvpStatus) => void;
  disabled?: boolean;
  size?: "sm" | "md";
  showKeys?: boolean;
}) => (
  <Segmented
    label="Your response"
    look="divided"
    size={props.size === "sm" ? "sm" : "md"}
    value={props.value as RsvpStatus | null | undefined}
    onChange={props.onAnswer}
    disabled={props.disabled}
    keepChosen
    options={RSVP_ANSWERS.map((answer) => ({
      value: answer.status,
      name: answer.label,
      tone: answer.tone,
      ariaKey: props.showKeys ? answer.ariaKey : undefined,
      label: <>{answer.label}{props.showKeys && <KeyHint keys={answer.keyHint} />}</>,
    }))}
  />
);
