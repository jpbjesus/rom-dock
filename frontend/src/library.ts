export type Entry = {
  name: string;
  size: number;
  modified: number;
  directory: boolean;
  symlink: boolean;
};

export const systems: Record<string, [string, string, string]> = {
  snes: ["Super Nintendo", "SNES", "#bba4ed"],
  nes: ["Nintendo Entertainment System", "NES", "#ef9587"],
  gba: ["Game Boy Advance", "GBA", "#ab9aef"],
  gb: ["Game Boy", "GB", "#c0d69a"],
  gbc: ["Game Boy Color", "GBC", "#a0d0a9"],
  n64: ["Nintendo 64", "N64", "#88b8e6"],
  nds: ["Nintendo DS", "NDS", "#c0c6cc"],
  megadrive: ["Mega Drive", "MD", "#91aed6"],
  genesis: ["Sega Genesis", "MD", "#91aed6"],
  mastersystem: ["Master System", "MS", "#e5a28a"],
  gamegear: ["Game Gear", "GG", "#a4bdda"],
  psx: ["PlayStation", "PS1", "#b0c4de"],
  psp: ["PlayStation Portable", "PSP", "#b3bdcf"],
  arcade: ["Arcade", "ARC", "#f2c77b"],
  mame: ["MAME", "MAME", "#f2c77b"],
  neogeo: ["Neo Geo", "NEO", "#e8c475"],
  dreamcast: ["Dreamcast", "DC", "#e2a282"],
  atari2600: ["Atari 2600", "2600", "#d9a386"],
  ports: ["Ports", "PORT", "#8ac8c0"],
  bios: ["BIOS", "BIOS", "#b2b9c2"],
  favorites: ["Favoritos", "FAV", "#c4f578"],
  scummvm: ["ScummVM", "SVM", "#a9c983"],
  dos: ["DOS", "DOS", "#b0b5ba"],
  saturn: ["Sega Saturn", "SAT", "#9bc2dc"],
  pcengine: ["PC Engine", "PCE", "#d7a2b2"],
  fba: ["FinalBurn Alpha", "FBA", "#d9bb90"],
};
export const systemName = (name: string) => systems[name]?.[0] || name;
export const bytes = (n: number) =>
  !n
    ? "0 B"
    : n < 1024
      ? `${n} B`
      : `${(n / 1024 ** Math.floor(Math.log(n) / Math.log(1024))).toLocaleString("pt-PT", { maximumFractionDigits: 1 })} ${["B", "KB", "MB", "GB", "TB"][Math.floor(Math.log(n) / Math.log(1024))]}`;
export const join = (path: string, name: string) =>
  path ? `${path}/${name}` : name;
export const date = (value: number) =>
  new Date(value * 1000).toLocaleDateString("pt-PT", {
    day: "2-digit",
    month: "short",
    year: "numeric",
  });
