// helpers/storage.ts
export function toMediaSignedPath(sbUrl: string) {
  // sb://media/deviceA/... or sb://thumbs/deviceA/...
  const path = sbUrl.replace(/^sb:\/\/(media|thumbs)\//, '');
  return { bucket: 'media', path };
}

export function uniqueMediaPaths(urls: string[]) {
  const paths = urls.map(u => toMediaSignedPath(u).path);
  return Array.from(new Set(paths));
}
