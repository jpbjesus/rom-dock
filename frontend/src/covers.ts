export type Cover = { image: string; version: string };
const nonGame = new Set([
  "xml",
  "txt",
  "json",
  "cfg",
  "ini",
  "db",
  "png",
  "jpg",
  "jpeg",
  "webp",
  "gif",
  "svg",
  "mp4",
  "mp3",
  "wav",
  "ogg",
  "srm",
  "sav",
  "state",
  "bak",
  "pdf",
  "log",
]);
export const coverEligible = (name: string) =>
  !name.startsWith(".") && !nonGame.has(name.split(".").at(-1)!.toLowerCase());
export const imageURL = (cover: Cover, generation: string) =>
  "/api/image?" +
  new URLSearchParams({
    path: cover.image,
    generation,
    version: cover.version,
  });
