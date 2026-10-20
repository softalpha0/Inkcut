import { LIMITS, type StylePreset } from "@inkcut/shared";
import type { LlmMessage } from "./types.js";

export function scriptMessages(topic: string, targetWords: number): LlmMessage[] {
  return [
    {
      role: "system",
      content: [
        "You write narration scripts for faceless, illustrated cartoon explainer videos (history, psychology, science, finance, stories).",
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
        `You are the storyboard artist for a narrated, illustrated explainer video drawn in the "${style.name}" style.`,
        "The narration is already split into numbered scenes. For EVERY scene, describe one illustration shown while that line is spoken.",
        "",
        `Art style (added automatically later, do NOT repeat it): ${style.name}: ${style.promptPrefix}`,
        style.characterSheet
          ? `Standard character look (added automatically later): ${style.characterSheet}`
          : "",
        "",
        "Rules:",
        `- First define the recurring characters in \`characters\`: one sentence each, with a short name and 1-2 fixed visual traits that suit the art style (e.g. '${style.exampleCharacter ?? "Sam: a cartoon man with a red scarf"}'). Keep it under 60 words.`,
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

/** Thumbnail ideas: three different click-worthy hooks for the same video. */
export function thumbnailMessages(
  title: string,
  narration: string,
  style: StylePreset,
  characters: string | undefined,
): LlmMessage[] {
  return [
    {
      role: "system",
      content: [
        "You design YouTube thumbnails that people want to click, for a narrated illustrated explainer video.",
        `Art style (added automatically later, do NOT repeat it): ${style.name}.`,
        characters ? `Recurring characters (describe them with exactly these words): ${characters}` : "",
        "",
        `Make exactly ${LIMITS.thumbnailsPerVideo} thumbnails, each with a DIFFERENT angle:`,
        "1. Curiosity: a question or mystery the viewer needs answered.",
        "2. Emotion: shock, fear or surprise about the most dramatic fact.",
        "3. Payoff: the surprising result, mistake or secret the video reveals.",
        "",
        "Rules for `headline`:",
        `- 2 to 4 words (never more than ${LIMITS.maxThumbnailHeadlineWords}), under ${LIMITS.maxThumbnailHeadlineChars} characters, ALL CAPS.`,
        "- Wrap the single most important word in *asterisks* so it is highlighted, e.g. 'THEY *LIED* TO YOU'.",
        "- It must complement the title, not repeat it. Honest: the video must deliver what it promises.",
        "- No emojis, hashtags, quotes or punctuation except ? or !.",
        "",
        "Rules for `imagePrompt` (20 to 45 words):",
        "- ONE recurring character in close-up with a big, exaggerated facial expression that fits the headline.",
        "- One or two large, simple props that tell the story at a glance (money bag, broken phone, clock...).",
        "- Put the character and props in the RIGHT half of the frame; keep the LEFT half a plain, simple, bright background (the headline goes there).",
        "- Bold, high-contrast, uncluttered. Absolutely no text, letters, numbers, signs or speech bubbles.",
        "",
        "Reply with ONLY a JSON object in exactly this shape (no markdown):",
        '{"thumbnails": [{"headline": "...", "imagePrompt": "..."}, {"headline": "...", "imagePrompt": "..."}, {"headline": "...", "imagePrompt": "..."}]}',
      ]
        .filter((line) => line !== "")
        .join("\n"),
    },
    { role: "user", content: `Video title: ${title}\n\nNarration:\n${narration}` },
  ];
}

/** YouTube upload details; titles[i] is written to pair with thumbnail headline i. */
export function youtubeKitMessages(title: string, narration: string, headlines: string[]): LlmMessage[] {
  return [
    {
      role: "system",
      content: [
        "You are a YouTube growth expert writing the upload details for a narrated, illustrated video.",
        "",
        `titles: exactly ${headlines.length} titles. Title i is shown together with thumbnail i in YouTube's A/B test, so it must fit that thumbnail's headline without repeating it word for word:`,
        ...headlines.map((h, i) => `  thumbnail ${i + 1} headline: "${h.replace(/\*/g, "")}"`),
        "  Each title: under 60 characters if possible (never over 90), curiosity or a clear benefit, honest (the video must deliver it), Title Case, no emojis, no ALL CAPS, no hashtags.",
        "description: 3 short paragraphs in plain text.",
        "  1) The first two lines are a hook that makes people want to watch (they show before 'more').",
        "  2) What the viewer will learn or experience, without spoiling the ending.",
        "  3) A friendly line asking viewers to subscribe and comment.",
        "  Do not mention AI, tools or how the video was made. No links. No hashtags inside the description (they are added separately).",
        "tags: 10 to 15 search phrases people would type, from broad to specific, lowercase, no # signs.",
        "hashtags: exactly 3 short hashtags for the topic, each starting with #.",
        "pinnedComment: one short question (under 150 characters) that gets viewers to reply with their own experience or opinion. One emoji at most.",
        "",
        "Reply with ONLY a JSON object in exactly this shape (no markdown):",
        '{"titles": ["...", "...", "..."], "description": "...", "tags": ["...", "..."], "hashtags": ["#...", "#...", "#..."], "pinnedComment": "..."}',
      ].join("\n"),
    },
    { role: "user", content: `Video topic: ${title}\n\nNarration:\n${narration}` },
  ];
}
