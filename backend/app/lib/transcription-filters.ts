export const knownErrors = new Set([
  'Продолжение следует...',
  '.',
  '...',
  'Субтитры сделал DimaTorzok',
  '*',
  'おやすみなさい。',
  '*sad breathing*',
  '*mimics*',
  '- Mm.',
  '- Oh.',
  '- Yeah.',
  'И...',
  'uh',
  'Ну...',
  '-',
  'Дякую за перегляд!',
  'oh',
]);

export const asteriskPattern = /^\*.*\*$/;

export const removeIfLonely = new Set([
  'Thank you.',
  "I'm sorry.",
  'Okay.',
  'All right.',
  'Спасибо.',
  'Дякую.',
  'Gracias.',
  'Obrigado.',
  'Dziękuję.',
]);

export function filterSegments(segments: any[]) {
  const filtered = segments.filter((segment) => {
    const text = segment.text?.trim().toLowerCase();
    if (!text) return false;
    if (knownErrors.has(segment.text?.trim())) return false; // Check original case for some errors
    if (knownErrors.has(text)) return false;
    if (asteriskPattern.test(text)) return false;
    return true;
  });

  if (filtered.length === 0) return [];
  
  if (filtered.length === 1) {
    const text = filtered[0].text?.trim();
    if (removeIfLonely.has(text)) return [];
  }

  return filtered;
}


