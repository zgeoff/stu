// The id of each message the events name, once each, in the order the events first name it.
export function collectMessageIDs(events: readonly { readonly message?: string | undefined }[]) {
  const ids = new Set<string>();

  for (const event of events) {
    if (event.message !== undefined) {
      ids.add(event.message);
    }
  }

  return [...ids];
}
