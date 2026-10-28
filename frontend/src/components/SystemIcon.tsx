import type { CSSProperties } from "react";
const controllers: Record<string, string> = {
  snes: "snes",
  sfc: "snes",
  snesmsu1: "snes",
  satellaview: "snes",
  nes: "nes",
  fds: "nes",
  n64: "n64",
  megadrive: "mega-drive",
  genesis: "mega-drive",
  sega32x: "mega-drive",
  segacd: "mega-drive",
  mastersystem: "master-system",
  saturn: "sega-saturn",
  dreamcast: "dreamcast",
  psx: "ps1",
  ps1: "ps1",
  ps2: "ps2",
  ps3: "ps3",
  gamecube: "gamecube",
  gc: "gamecube",
  wii: "wii",
  wiiu: "wii-u",
  virtualboy: "virtual-boy",
  atari2600: "atari-2600",
  atarijaguar: "atari-jaguar",
  switch: "joy-cons",
  xbox: "xbox",
  xbox360: "xbox-360",
};
const handhelds = new Set([
  "gb",
  "gbc",
  "gba",
  "gamegear",
  "nds",
  "3ds",
  "psp",
  "atarilynx",
  "ngp",
  "ngpc",
  "wswan",
  "wswanc",
]);
export const hasSystemIcon = (system: string) =>
  !!controllers[system] || handhelds.has(system);
export default function SystemIcon({ system }: { system: string }) {
  const controller = controllers[system];
  if (controller)
    return (
      <span
        className="system-icon controller-icon"
        data-system-icon={system}
        aria-hidden="true"
        style={
          {
            maskImage: `url('/system-icons/${controller}.svg')`,
            WebkitMaskImage: `url('/system-icons/${controller}.svg')`,
          } as CSSProperties
        }
      />
    );
  if (!handhelds.has(system)) return null;
  const wide = ["gba", "psp", "gamegear", "atarilynx"].includes(system),
    dual = ["nds", "3ds"].includes(system);
  return (
    <svg
      className="system-icon"
      data-system-icon={system}
      viewBox="0 0 64 64"
      fill="none"
      stroke="currentColor"
      strokeWidth="3"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {wide ? (
        <>
          <rect x="3" y="15" width="58" height="34" rx="10" />
          <rect x="18" y="21" width="28" height="21" rx="2" />
          <path d="M7 30h8m-4-4v8" />
          <circle cx="53" cy="28" r="1.5" fill="currentColor" />
          <circle cx="56" cy="35" r="1.5" fill="currentColor" />
        </>
      ) : dual ? (
        <>
          <rect x="13" y="3" width="38" height="58" rx="5" />
          <path d="M14 31h36" />
          <rect x="20" y="9" width="24" height="16" rx="1" />
          <rect x="22" y="36" width="20" height="16" rx="1" />
          <path d="M15 43h5m-2-3v6m27-5h3m-2 4h3" />
        </>
      ) : (
        <>
          <rect x="14" y="3" width="36" height="58" rx="6" />
          <rect x="20" y="10" width="24" height="22" rx="2" />
          <path d="M19 44h12m-6-6v12m7 6 5-1m2 0 5-1" />
          <circle cx="39" cy="40" r="2" fill="currentColor" />
          <circle cx="44" cy="46" r="2" fill="currentColor" />
        </>
      )}
    </svg>
  );
}
