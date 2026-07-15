export function normalize(value) {
  return String(value ?? '')
    .normalize('NFKC')
    .trim()
    .toLocaleLowerCase('ja-JP');
}

function classifyMatch(name, query) {
  if (!query) return { rank: 3, matchIndex: -1 };
  if (name === query) return { rank: 0, matchIndex: 0 };
  if (name.startsWith(query)) return { rank: 1, matchIndex: 0 };

  const matchIndex = name.indexOf(query);
  if (matchIndex >= 0) return { rank: 2, matchIndex };
  return null;
}

export function searchSheets(sheets, query) {
  const normalizedQuery = normalize(query);

  return sheets
    .map((name, index) => ({ name: String(name), index }))
    .map((sheet) => {
      const match = classifyMatch(normalize(sheet.name), normalizedQuery);
      return match ? { ...sheet, ...match } : null;
    })
    .filter(Boolean)
    .sort((left, right) =>
      left.rank - right.rank ||
      left.matchIndex - right.matchIndex ||
      left.name.length - right.name.length ||
      left.index - right.index,
    );
}
