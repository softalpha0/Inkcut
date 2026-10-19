export interface LlmMessage {
  role: "system" | "user" | "assistant";
  content: string;
}

export interface LlmClient {
  readonly name: string;
  /** Returns the assistant's text reply. Must include a system message (SERV rejects requests without one). */
  chat(messages: LlmMessage[]): Promise<string>;
}
