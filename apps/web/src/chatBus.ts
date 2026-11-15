/** Lets left-panel buttons hand a draft to the chat input ("ask the AI for ...") without prop drilling. */
const EVENT = "apr:chat-draft";

export function draftForAi(text: string) {
  window.dispatchEvent(new CustomEvent<string>(EVENT, { detail: text }));
}

export function onChatDraft(handler: (text: string) => void): () => void {
  const listener = (e: Event) => handler((e as CustomEvent<string>).detail);
  window.addEventListener(EVENT, listener);
  return () => window.removeEventListener(EVENT, listener);
}
