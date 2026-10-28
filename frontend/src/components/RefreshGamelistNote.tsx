import { Gamepad2 } from "lucide-react";
export default function RefreshGamelistNote() {
  return (
    <div className="refresh-gamelist-note">
      <Gamepad2 size={17} />
      <p>
        Para os jogos aparecerem na consola:
        <strong>START → Game Settings → Update Gamelists</strong>
      </p>
    </div>
  );
}
