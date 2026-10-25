// Typed subscriptions to Rust events. A payload that fails its shape check is dropped and
// reported, never handed to the UI.

import { transport } from "$transport";

import type { EventName, Events, WindowLabel } from "./types";
import { guards } from "./validate";

export function on<K extends EventName>(
  event: K,
  label: WindowLabel,
  handler: (payload: Events[K]) => void,
  onInvalid: (event: K) => void = () => {},
): Promise<() => void> {
  return transport.listen(event, label, (payload) => {
    if (guards[event](payload)) handler(payload);
    else onInvalid(event);
  });
}
