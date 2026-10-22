export type ItemReview = { looksGood: boolean; notes: string };

// The review as Markdown: the batch's heading, the overall thoughts, then one
// bullet per item in page order with its notes quoted beneath it.
export function reviewMarkdown(
  title: string,
  overall: string,
  items: { title: string; review: ItemReview | undefined }[],
) {
  const lines = [
    `# ${title} review`,
    "",
    overall.trim() || "_No overall thoughts._",
    "",
  ];
  for (const { title, review } of items) {
    const notes = review?.notes.trim() ?? "";
    const status = review?.looksGood ? "Looks good" : "Needs review";
    lines.push(
      `- **${title}**: ${status}${notes || review?.looksGood ? "" : ", no comments"}`,
    );
    if (notes) {
      for (const line of notes.split("\n")) {
        lines.push(`  >${line.trimEnd() ? ` ${line.trimEnd()}` : ""}`);
      }
    }
  }
  lines.push("");
  return lines.join("\n");
}
