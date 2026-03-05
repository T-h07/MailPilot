export type HighlightSegment = {
  text: string;
  highlighted: boolean;
};

export function highlightText(input: string, query: string): HighlightSegment[] {
  const trimmed = query.trim();
  if (!trimmed) {
    return [{ text: input, highlighted: false }];
  }

  const source = input.toLowerCase();
  const needle = trimmed.toLowerCase();
  const segments: HighlightSegment[] = [];
  let cursor = 0;
  let foundIndex = source.indexOf(needle, cursor);

  while (foundIndex !== -1) {
    if (foundIndex > cursor) {
      segments.push({ text: input.slice(cursor, foundIndex), highlighted: false });
    }
    segments.push({
      text: input.slice(foundIndex, foundIndex + needle.length),
      highlighted: true,
    });
    cursor = foundIndex + needle.length;
    foundIndex = source.indexOf(needle, cursor);
  }

  if (cursor < input.length) {
    segments.push({ text: input.slice(cursor), highlighted: false });
  }

  return segments.length > 0 ? segments : [{ text: input, highlighted: false }];
}
