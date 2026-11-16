import { type Ack, AVATARS, type Command, type RoomView } from "@apr/shared";
import { useState } from "react";

/** A stable colour per player, so the same person is the same colour everywhere. */
export const playerHue = (id: string) => [...id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) % 360, 11);

export function Avatar({ room, id, size = "m" }: { room: RoomView; id: string; size?: "s" | "m" | "l" }) {
  const member = room.members.find((m) => m.id === id);
  return (
    <span
      className={`avatar ${size}${member && !member.connected ? " off" : ""}`}
      style={{ "--hue": playerHue(id) } as React.CSSProperties}
      title={member?.nickname}
    >
      {member?.avatar ?? "❔"}
    </span>
  );
}

/** A player as a picture and a name, for lists inside games. */
export function Who({ room, id }: { room: RoomView; id: string }) {
  return (
    <span className="who-tag">
      <Avatar room={room} id={id} size="s" />
      {room.members.find((m) => m.id === id)?.nickname ?? "?"}
    </span>
  );
}

/** Your own picture; pressing it opens the choices. */
export function AvatarPicker({ room, command }: { room: RoomView; command(c: Command): Promise<Ack> }) {
  const [open, setOpen] = useState(false);
  const me = room.me.playerId;
  const mine = room.members.find((m) => m.id === me)?.avatar;
  return (
    <span className="avatar-picker">
      <button type="button" className="avatar-button" title="换头像" onClick={() => setOpen((o) => !o)}>
        <Avatar room={room} id={me} />
      </button>
      {open && (
        <div className="avatar-grid">
          {AVATARS.map((a) => (
            <button
              key={a}
              type="button"
              className={a === mine ? "on" : ""}
              onClick={() => {
                void command({ type: "setAvatar", avatar: a });
                setOpen(false);
              }}
            >
              {a}
            </button>
          ))}
        </div>
      )}
    </span>
  );
}
