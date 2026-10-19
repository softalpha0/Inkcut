import type { StylePreset } from "@inkcut/shared";
import type { LlmMessage } from "./types.js";

export function scriptMessages(topic: string, targetWords: number): LlmMessage[] {
  return [
    {
      role: "system",
      content: [
        "You write narration scripts for faceless, illustrated stickman explainer videos (history, psychology, science).",
        "The narration is read aloud by a text-to-speech voice, word for word.",
        "",
        "Rules:",
        `- Length: about ${targetWords} words (stay within 10% of that).`,
        "- Output ONLY the words to be spoken. No title, headings, labels, bullet points, markdown, emojis, stage directions, or notes.",
        "- Plain sentences, mostly 8 to 18 words each. Conversational, concrete, vivid.",
        "- Open with a hook in the first sentence. Build one clear idea at a time. End with a short takeaway.",
        "- Use simple examples a viewer can picture. Avoid lists of numbers, URLs, and abbreviations a voice would stumble on.",
        "- Write numbers as a narrator would say them.",
      ].join("\n"),
    },
    { role: "user", content: `Topic: ${topic}\n\nWrite the narration now.` },
  ];
}

export function planMessages(chunks: string[], style: StylePreset): LlmMessage[] {
  const numbered = chunks.map((c, i) => `${i}: ${c}`).join("\n");
  return [
    {
      role: "system",
      content: [
        "You are the storyboard artist for a narrated stickman explainer video.",
        "The narration is already split into numbered scenes. For EVERY scene, describe one illustration shown while that line is spoken.",
        "",
        `Art style (added automatically later, do NOT repeat it): ${style.name}: ${style.promptPrefix}`,
        style.characterSheet
          ? `Standard character look (added automatically later): ${style.characterSheet}`
          : "",
        "",
        "Rules:",
        "- First define the recurring characters in `characters`: one sentence each, with a short name and 1-2 fixed visual traits (e.g. 'Sam: a stick figure with a red scarf'). Keep it under 60 words.",
        "- Every imagePrompt that shows a recurring character must describe them with exactly the same words as in `characters`.",
        "- Each imagePrompt shows ONE clear moment: who, doing what, where, with which key objects. 15 to 45 words. Concrete and literal; no metaphors the artist can't draw.",
        "- Absolutely no text, letters, numbers, signs, labels, speech bubbles or captions in the image.",
        "- `visual` is a short plain description for the editor (under 20 words).",
        "- `motion` is one of: zoom_in, zoom_out, pan_left, pan_right, static. Vary it; use zoom_in for emotional or key moments, pans for scenes with movement or wide settings.",
        "- `animationPrompt` says what moves if this illustration is animated: 8 to 25 words of small, natural motion (a gesture, a head turn, objects shifting). Keep the camera mostly still, keep characters on-model, no new objects, no text.",
        "",
        "Reply with ONLY a JSON object in exactly this shape (no markdown):",
        '{"characters": "...", "scenes": [{"index": 0, "visual": "...", "imagePrompt": "...", "motion": "zoom_in", "animationPrompt": "..."}]}',
        `There must be exactly ${chunks.length} scenes, with index 0 to ${chunks.length - 1} in order.`,
      ]
        .filter((line) => line !== "")
        .join("\n"),
    },
    { role: "user", content: `Scenes:\n${numbered}` },
  ];
}
